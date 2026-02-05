import { Client, db, exitNodes, Olm, sites, clientSitesAssociationsCache, targets, resources } from "@server/db";
import { buildSiteConfigurationForOlmClient } from "./buildConfiguration";
import { sendToClient } from "#dynamic/routers/ws";
import logger from "@server/logger";
import { eq, inArray, and } from "drizzle-orm";
import config from "@server/lib/config";
import { buildDNSAuthorityConfig, sendDNSAuthorityConfigToOlm } from "@server/routers/dns/dnsAuthority";

export async function sendOlmSyncMessage(olm: Olm, client: Client) {
    // NOTE: WE ARE HARDCODING THE RELAY PARAMETER TO FALSE HERE BUT IN THE REGISTER MESSAGE ITS DEFINED BY THE CLIENT
    const siteConfigurations = await buildSiteConfigurationForOlmClient(
        client,
        client.pubKey,
        false
    );

    // Get all exit nodes from sites where the client has peers
    const clientSites = await db
        .select()
        .from(clientSitesAssociationsCache)
        .innerJoin(
            sites,
            eq(sites.siteId, clientSitesAssociationsCache.siteId)
        )
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId));

    // Extract unique exit node IDs
    const exitNodeIds = Array.from(
        new Set(
            clientSites
                .map(({ sites: site }) => site.exitNodeId)
                .filter((id): id is number => id !== null)
        )
    );

    let exitNodesData: {
        publicKey: string;
        relayPort: number;
        endpoint: string;
        siteIds: number[];
    }[] = [];

    if (exitNodeIds.length > 0) {
        const allExitNodes = await db
            .select()
            .from(exitNodes)
            .where(inArray(exitNodes.exitNodeId, exitNodeIds));

        // Map exitNodeId to siteIds
        const exitNodeIdToSiteIds: Record<number, number[]> = {};
        for (const { sites: site } of clientSites) {
            if (site.exitNodeId !== null) {
                if (!exitNodeIdToSiteIds[site.exitNodeId]) {
                    exitNodeIdToSiteIds[site.exitNodeId] = [];
                }
                exitNodeIdToSiteIds[site.exitNodeId].push(site.siteId);
            }
        }

        exitNodesData = allExitNodes.map((exitNode) => {
            return {
                publicKey: exitNode.publicKey,
                relayPort: config.getRawConfig().gerbil.clients_start_port,
                endpoint: exitNode.endpoint,
                siteIds: exitNodeIdToSiteIds[exitNode.exitNodeId] ?? []
            };
        });
    }

    logger.debug("sendOlmSyncMessage: sending sync message");

    await sendToClient(olm.olmId, {
        type: "olm/sync",
        data: {
            sites: siteConfigurations,
            exitNodes: exitNodesData
        }
    }).catch((error) => {
        logger.warn(`Error sending olm sync message:`, error);
    });

    // After sync, send DNS authority configurations for any resources that
    // have DNS authority enabled on sites this OLM is associated with.
    // This ensures reconnecting OLM clients pick up current DNS authority zones.
    await sendDNSAuthorityZonesToOlm(olm, client).catch((error) => {
        logger.warn(`Error sending DNS authority zones during OLM sync:`, error);
    });
}

/**
 * Send all DNS authority zone configs to an OLM client.
 * Called during sync to bootstrap/reconcile the OLM's DNS authority server.
 *
 * Finds all resources with dnsAuthorityEnabled that are targeted at sites
 * this OLM's client is associated with, builds configs, and pushes them.
 */
async function sendDNSAuthorityZonesToOlm(olm: Olm, client: Client) {
    // Get sites this OLM client is associated with
    const associatedSites = await db
        .select({ siteId: clientSitesAssociationsCache.siteId })
        .from(clientSitesAssociationsCache)
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId));

    if (associatedSites.length === 0) {
        return;
    }

    const siteIds = associatedSites.map((s) => s.siteId);

    // Find resources that have dnsAuthorityEnabled and are targeted at these sites
    const dnsResources = await db
        .select({
            resourceId: resources.resourceId,
            dnsAuthorityEnabled: resources.dnsAuthorityEnabled,
            siteDnsAuthorityEnabled: sites.dnsAuthorityEnabled,
            sitePublicIp: sites.publicIp
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .where(
            and(
                eq(targets.enabled, true),
                eq(resources.dnsAuthorityEnabled, true),
                eq(sites.dnsAuthorityEnabled, true)
            )
        );

    // Filter to resources targeted at our associated sites and deduplicate
    const relevantResourceIds = Array.from(
        new Set(
            dnsResources
                .filter((r) => {
                    // We need to re-check siteId membership since inArray on
                    // a variable list isn't always safe across DB drivers
                    return r.sitePublicIp && r.siteDnsAuthorityEnabled;
                })
                .map((r) => r.resourceId)
        )
    );

    if (relevantResourceIds.length === 0) {
        return;
    }

    // Build configs and send as zone updates
    const zones = [];
    for (const resourceId of relevantResourceIds) {
        const zoneConfig = await buildDNSAuthorityConfig(resourceId);
        if (zoneConfig) {
            zones.push(zoneConfig);
        }
    }

    if (zones.length > 0) {
        logger.info(
            `Sending ${zones.length} DNS authority zone(s) to OLM ${olm.olmId} during sync`
        );
        await sendDNSAuthorityConfigToOlm(olm.olmId, {
            action: "update",
            zones: zones
        });
    }
}
