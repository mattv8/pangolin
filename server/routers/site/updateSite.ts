import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { sites } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { isValidCIDR } from "@server/lib/validators";
import { getServerIp } from "@server/lib/serverIpService";

const updateSiteParamsSchema = z.strictObject({
    siteId: z.string().transform(Number).pipe(z.int().positive())
});

const updateSiteBodySchema = z
    .strictObject({
        name: z.string().min(1).max(255).optional(),
        niceId: z.string().min(1).max(255).optional(),
        dockerSocketEnabled: z.boolean().optional(),
        remoteSubnets: z.string().optional(),
        publicIp: z.ipv4().nullable().optional(),
        dnsAuthorityEnabled: z.boolean().optional()
        // subdomain: z
        //     .string()
        //     .min(1)
        //     .max(255)
        //     .transform((val) => val.toLowerCase())
        //     .optional()
        // pubKey: z.string().optional(),
        // subnet: z.string().optional(),
        // exitNode: z.number().int().positive().optional(),
        // megabytesIn: z.number().int().nonnegative().optional(),
        // megabytesOut: z.number().int().nonnegative().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field must be provided for update"
    });

registry.registerPath({
    method: "post",
    path: "/site/{siteId}",
    description: "Update a site.",
    tags: [OpenAPITags.Site],
    request: {
        params: updateSiteParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateSiteBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function updateSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateSiteParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = updateSiteBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;
        const updateData = parsedBody.data;

        // if niceId is provided, check if it's already in use by another site
        if (updateData.niceId) {
            const existingSite = await db
                .select()
                .from(sites)
                .where(
                    and(
                        eq(sites.niceId, updateData.niceId),
                        eq(sites.orgId, sites.orgId)
                    )
                )
                .limit(1);

            if (existingSite.length > 0 && existingSite[0].siteId !== siteId) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `A site with niceId "${updateData.niceId}" already exists`
                    )
                );
            }
        }

        // if remoteSubnets is provided, ensure it's a valid comma-separated list of cidrs
        if (updateData.remoteSubnets) {
            const subnets = updateData.remoteSubnets
                .split(",")
                .map((s) => s.trim());
            for (const subnet of subnets) {
                if (!isValidCIDR(subnet)) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            `Invalid CIDR format: ${subnet}`
                        )
                    );
                }
            }
        }

// if enabling DNS Authority, ensure a publicIp is set (either in update, existing, or server-detected)
        if (updateData.dnsAuthorityEnabled === true && !updateData.publicIp) {
            const existingSite = await db
                .select({ publicIp: sites.publicIp })
                .from(sites)
                .where(eq(sites.siteId, siteId))
                .limit(1);

            if (!existingSite.length || !existingSite[0].publicIp) {
                // Fall back to server's detected public IP
                const serverIp = getServerIp();
                if (serverIp) {
                    updateData.publicIp = serverIp;
                } else {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Public IP is required when enabling DNS Authority. Could not auto-detect server IP."
                        )
                    );
                }
            }
        }

        const updatedSite = await db
            .update(sites)
            .set(updateData)
            .where(eq(sites.siteId, siteId))
            .returning();

        if (updatedSite.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${siteId} not found`
                )
            );
        }

        return response(res, {
            data: updatedSite[0],
            success: true,
            error: false,
            message: "Site updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
