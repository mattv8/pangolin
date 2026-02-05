import { sendToClient } from "#dynamic/routers/ws";
import { db } from "@server/db";
import { sites, resources, targets, targetHealthCheck, clients, clientSitesAssociationsCache, olms, newts } from "@server/db";
import logger from "@server/logger";
import { eq, and, isNotNull } from "drizzle-orm";

// DNSAuthorityTarget represents a target IP with health status
interface DNSAuthorityTarget {
    ip: string;
    priority: number;
    healthy: boolean;
    siteId: number;
    siteName: string;
}

// DNSAuthorityConfig holds configuration for a DNS authority zone
interface DNSAuthorityConfig {
    enabled: boolean;
    domain: string;
    ttl: number;
    routingPolicy: string;
    targets: DNSAuthorityTarget[];
}

// DNSAuthorityConfigMessage represents the message to send to OLM
interface DNSAuthorityConfigMessage {
    action: "update" | "remove" | "start" | "stop";
    zones: DNSAuthorityConfig[];
}

/**
 * Build DNS authority configuration for a resource based on its targets
 */
export async function buildDNSAuthorityConfig(
    resourceId: number
): Promise<DNSAuthorityConfig | null> {
    const [resource] = await db
        .select()
        .from(resources)
        .where(eq(resources.resourceId, resourceId))
        .limit(1);

    if (!resource) {
        return null;
    }

    // Check if DNS authority is enabled for this resource
    if (!resource.dnsAuthorityEnabled) {
        return null;
    }

    // Get the domain for this resource
    const domain = resource.fullDomain;
    if (!domain) {
        logger.warn(
            `Resource ${resourceId} has DNS authority enabled but no domain configured`
        );
        return null;
    }

    // Get all targets for this resource with their health check status
    const resourceTargets = await db
        .select({
            targetId: targets.targetId,
            siteId: targets.siteId,
            ip: targets.ip,
            port: targets.port,
            enabled: targets.enabled,
            priority: targets.priority,
            siteName: sites.name,
            sitePublicIp: sites.publicIp,
            siteDnsAuthorityEnabled: sites.dnsAuthorityEnabled,
            hcEnabled: targetHealthCheck.hcEnabled,
            hcHealth: targetHealthCheck.hcHealth
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .leftJoin(
            targetHealthCheck,
            eq(targets.targetId, targetHealthCheck.targetId)
        )
        .where(eq(targets.resourceId, resourceId));

    // Filter to only enabled targets that have sites with DNS authority enabled and public IPs
    const validTargets = resourceTargets.filter(
        (t: typeof resourceTargets[number]) =>
            t.enabled &&
            t.sitePublicIp &&
            t.siteDnsAuthorityEnabled
    );

    if (validTargets.length === 0) {
        logger.debug(
            `Resource ${resourceId} has no valid DNS authority targets (no sites with public IPs or DNS authority enabled)`
        );
        return null;
    }

    const dnsTargets: DNSAuthorityTarget[] = validTargets.map((t: typeof resourceTargets[number]) => ({
        ip: t.sitePublicIp!, // Public IP of the site, not the internal target IP
        priority: t.priority || 100,
        healthy: t.hcEnabled ? t.hcHealth === "healthy" : true, // If no health check, assume healthy
        siteId: t.siteId,
        siteName: t.siteName || `Site ${t.siteId}`
    }));

    return {
        enabled: true,
        domain: domain,
        ttl: resource.dnsAuthorityTtl || 60,
        routingPolicy: resource.dnsAuthorityRoutingPolicy || "failover",
        targets: dnsTargets
    };
}

/**
 * Get all OLM clients that need to receive DNS authority updates for a resource.
 *
 * OLM clients act as redundant, local-resolver nameservers. When a site has
 * dnsAuthorityEnabled, any connected OLM that is associated with that site
 * (via clientSitesAssociationsCache) is a candidate for running a secondary
 * DNS authority server.
 *
 * Query path:  targets → sites → clientSitesAssociationsCache → clients → olms
 */
export async function getDNSAuthoritySiteOlmIds(
    resourceId: number
): Promise<string[]> {
    // Find sites that are targets for this resource with DNS authority enabled
    const resourceTargets = await db
        .select({
            siteId: targets.siteId,
            siteDnsAuthorityEnabled: sites.dnsAuthorityEnabled,
            sitePublicIp: sites.publicIp
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .where(
            and(
                eq(targets.resourceId, resourceId),
                eq(targets.enabled, true)
            )
        );

    // Filter to sites with DNS authority enabled and a public IP
    const dnsAuthoritySiteIds = resourceTargets
        .filter((t) => t.siteDnsAuthorityEnabled && t.sitePublicIp)
        .map((t) => t.siteId);

    if (dnsAuthoritySiteIds.length === 0) {
        return [];
    }

    // Find OLM clients connected to any of these sites
    // An OLM is identified by: clients.olmId → olms.olmId
    const olmClients = await db
        .select({
            olmId: clients.olmId
        })
        .from(clientSitesAssociationsCache)
        .innerJoin(
            clients,
            eq(clientSitesAssociationsCache.clientId, clients.clientId)
        )
        .where(
            and(
                // Match against any of the DNS-authority-enabled sites
                // We check each siteId individually since inArray may not be
                // available in all DB engines — there are typically few sites
                eq(clientSitesAssociationsCache.siteId, dnsAuthoritySiteIds[0]),
                isNotNull(clients.olmId)
            )
        );

    // For additional siteIds, run extra queries and merge results
    for (let i = 1; i < dnsAuthoritySiteIds.length; i++) {
        const extra = await db
            .select({ olmId: clients.olmId })
            .from(clientSitesAssociationsCache)
            .innerJoin(
                clients,
                eq(clientSitesAssociationsCache.clientId, clients.clientId)
            )
            .where(
                and(
                    eq(clientSitesAssociationsCache.siteId, dnsAuthoritySiteIds[i]),
                    isNotNull(clients.olmId)
                )
            );
        olmClients.push(...extra);
    }

    // De-duplicate OLM IDs
    const uniqueOlmIds = Array.from(
        new Set(
            olmClients
                .map((c) => c.olmId)
                .filter((id): id is string => !!id)
        )
    );

    logger.debug(
        `getDNSAuthoritySiteOlmIds: Found ${uniqueOlmIds.length} OLM client(s) for resource ${resourceId} across ${dnsAuthoritySiteIds.length} DNS-authority-enabled site(s)`
    );

    return uniqueOlmIds;
}

/**
 * Get all NEWT IDs that should serve DNS authority for a resource
 */
export async function getDNSAuthoritySiteNewtIds(
    resourceId: number
): Promise<{ newtId: string; siteId: number }[]> {
    const resourceTargets = await db
        .select({
            siteId: targets.siteId,
            newtId: newts.newtId,
            sitePublicIp: sites.publicIp,
            siteDnsAuthorityEnabled: sites.dnsAuthorityEnabled
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .innerJoin(newts, eq(sites.siteId, newts.siteId))
        .where(
            and(
                eq(targets.resourceId, resourceId),
                eq(targets.enabled, true)
            )
        );

    // Filter to sites with DNS authority enabled
    return resourceTargets
        .filter((t: typeof resourceTargets[number]) => t.sitePublicIp && t.siteDnsAuthorityEnabled)
        .map((t: typeof resourceTargets[number]) => ({
            newtId: t.newtId || "",
            siteId: t.siteId
        }))
        .filter((t: { newtId: string; siteId: number }) => t.newtId);
}

/**
 * Send DNS authority configuration update to a NEWT instance
 */
export async function sendDNSAuthorityConfigToNewt(
    newtId: string,
    config: DNSAuthorityConfigMessage
) {
    try {
        await sendToClient(newtId, {
            type: "newt/dns/authority/config",
            data: config
        });
        logger.debug(
            `Sent DNS authority config to NEWT ${newtId}: ${config.action} with ${config.zones.length} zones`
        );
    } catch (error) {
        logger.warn(`Error sending DNS authority config to NEWT ${newtId}:`, error);
    }
}

/**
 * Send DNS authority configuration update to an OLM instance.
 *
 * OLM acts as a redundant local-resolver nameserver. The message type mirrors
 * the Newt pattern but uses the "olm/" prefix. OLM already has a handler
 * registered for "olm/dns/authority/config" that starts/stops/updates its
 * DNSAuthorityServer (which binds 0.0.0.0:53 with pre-flight checks).
 */
export async function sendDNSAuthorityConfigToOlm(
    olmId: string,
    config: DNSAuthorityConfigMessage
) {
    try {
        await sendToClient(olmId, {
            type: "olm/dns/authority/config",
            data: config
        });
        logger.debug(
            `Sent DNS authority config to OLM ${olmId}: ${config.action} with ${config.zones.length} zones`
        );
    } catch (error) {
        logger.warn(`Error sending DNS authority config to OLM ${olmId}:`, error);
    }
}

/**
 * Update DNS authority configuration for all affected NEWT and OLM instances
 * when a resource is updated.
 */
export async function updateDNSAuthorityForResource(resourceId: number) {
    const config = await buildDNSAuthorityConfig(resourceId);

    // Get all NEWT instances that should serve this resource
    const newtSites = await getDNSAuthoritySiteNewtIds(resourceId);

    for (const { newtId } of newtSites) {
        if (config) {
            await sendDNSAuthorityConfigToNewt(newtId, {
                action: "update",
                zones: [config]
            });
        } else {
            // DNS authority disabled for this resource, remove the zone
            const [resource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);

            if (resource?.fullDomain) {
                await sendDNSAuthorityConfigToNewt(newtId, {
                    action: "remove",
                    zones: [{ domain: resource.fullDomain } as DNSAuthorityConfig]
                });
            }
        }
    }

    // Get all OLM instances that should serve as redundant nameservers
    const olmIds = await getDNSAuthoritySiteOlmIds(resourceId);

    for (const olmId of olmIds) {
        if (config) {
            await sendDNSAuthorityConfigToOlm(olmId, {
                action: "update",
                zones: [config]
            });
        } else {
            const [resource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);

            if (resource?.fullDomain) {
                await sendDNSAuthorityConfigToOlm(olmId, {
                    action: "remove",
                    zones: [{ domain: resource.fullDomain } as DNSAuthorityConfig]
                });
            }
        }
    }
}

/**
 * Update DNS authority health status when a target's health changes
 * This is called from handleHealthcheckStatusMessage
 */
export async function updateDNSAuthorityHealthForTarget(
    targetId: number,
    newHealthStatus: string
) {
    // Get the target and its resource
    const [targetInfo] = await db
        .select({
            resourceId: targets.resourceId,
            siteId: targets.siteId,
            fullDomain: resources.fullDomain,
            dnsAuthorityEnabled: resources.dnsAuthorityEnabled
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .where(eq(targets.targetId, targetId))
        .limit(1);

    if (!targetInfo || !targetInfo.dnsAuthorityEnabled) {
        return;
    }

    // Rebuild and send updated config to all affected sites
    await updateDNSAuthorityForResource(targetInfo.resourceId);
}

/**
 * Handle health check updates for multiple targets
 * This is called from handleHealthcheckStatusMessage after target health statuses are updated
 */
export async function onHealthCheckUpdate(targetIds: number[]) {
    // Deduplicate by resource ID to avoid sending multiple updates for the same resource
    const resourceIds = new Set<number>();

    for (const targetId of targetIds) {
        const [targetInfo] = await db
            .select({
                resourceId: targets.resourceId,
                dnsAuthorityEnabled: resources.dnsAuthorityEnabled
            })
            .from(targets)
            .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
            .where(eq(targets.targetId, targetId))
            .limit(1);

        if (targetInfo?.dnsAuthorityEnabled) {
            resourceIds.add(targetInfo.resourceId);
        }
    }

    // Update DNS authority config for each affected resource
    for (const resourceId of resourceIds) {
        await updateDNSAuthorityForResource(resourceId);
    }
}
