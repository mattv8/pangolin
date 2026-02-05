"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useSiteContext } from "@app/hooks/useSiteContext";
import { useForm } from "react-hook-form";
import { toast, useToast } from "@app/hooks/useToast";
import { useRouter } from "next/navigation";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm,
    SettingsSectionFooter
} from "@app/components/Settings";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useState } from "react";
import { SwitchInput } from "@app/components/SwitchInput";
import { useTranslations } from "next-intl";
import Link from "next/link";

const GeneralFormSchema = z.object({
    name: z.string().nonempty("Name is required"),
    niceId: z.string().min(1).max(255).optional(),
    dockerSocketEnabled: z.boolean().optional(),
    publicIp: z.ipv4().nullable().optional().or(z.literal("")),
    dnsAuthorityEnabled: z.boolean().optional()
}).refine(
    (data) => !data.dnsAuthorityEnabled || (data.publicIp && data.publicIp !== ""),
    {
        message: "Public IP is required when DNS Authority is enabled",
        path: ["publicIp"]
    }
);

type GeneralFormValues = z.infer<typeof GeneralFormSchema>;

export default function GeneralPage() {
    const { site, updateSite } = useSiteContext();

    const { env } = useEnvContext();
    const api = createApiClient(useEnvContext());
    const router = useRouter();
    const t = useTranslations();
    const { toast } = useToast();

    const [loading, setLoading] = useState(false);
    const [activeCidrTagIndex, setActiveCidrTagIndex] = useState<number | null>(
        null
    );

    const form = useForm({
        resolver: zodResolver(GeneralFormSchema),
        defaultValues: {
            name: site?.name,
            niceId: site?.niceId || "",
            dockerSocketEnabled: site?.dockerSocketEnabled ?? false,
            publicIp: site?.publicIp || "",
            dnsAuthorityEnabled: site?.dnsAuthorityEnabled ?? false
        },
        mode: "onChange"
    });

    async function onSubmit(data: GeneralFormValues) {
        setLoading(true);

        try {
            await api.post(`/site/${site?.siteId}`, {
                name: data.name,
                niceId: data.niceId,
                dockerSocketEnabled: data.dockerSocketEnabled,
                publicIp: data.publicIp || null,
                dnsAuthorityEnabled: data.dnsAuthorityEnabled
            });

            updateSite({
                name: data.name,
                niceId: data.niceId,
                dockerSocketEnabled: data.dockerSocketEnabled,
                publicIp: data.publicIp || null,
                dnsAuthorityEnabled: data.dnsAuthorityEnabled
            });

            if (data.niceId && data.niceId !== site?.niceId) {
                router.replace(
                    `/${site?.orgId}/settings/sites/${data.niceId}/general`
                );
            }

            toast({
                title: t("siteUpdated"),
                description: t("siteUpdatedDescription")
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("siteErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("siteErrorUpdateDescription")
                )
            });
        }

        setLoading(false);

        router.refresh();
    }

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("generalSettings")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("siteGeneralDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-6"
                                id="general-settings-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("name")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="niceId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t("identifier")}
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    placeholder={t(
                                                        "enterIdentifier"
                                                    )}
                                                    className="flex-1"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {site && site.type === "newt" && (
                                    <FormField
                                        control={form.control}
                                        name="dockerSocketEnabled"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <SwitchInput
                                                        id="docker-socket-enabled"
                                                        label={t(
                                                            "enableDockerSocket"
                                                        )}
                                                        defaultChecked={
                                                            field.value
                                                        }
                                                        onCheckedChange={
                                                            field.onChange
                                                        }
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                                <FormDescription>
                                                    {t(
                                                        "enableDockerSocketDescription"
                                                    )}{" "}
                                                    <Link
                                                        href="https://docs.pangolin.net/manage/sites/configure-site#docker-socket-integration"
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-primary hover:underline inline-flex items-center"
                                                    >
                                                        <span>
                                                            {t(
                                                                "enableDockerSocketLink"
                                                            )}
                                                        </span>
                                                    </Link>
                                                </FormDescription>
                                            </FormItem>
                                        )}
                                    />
                                )}

                                <FormField
                                    control={form.control}
                                    name="dnsAuthorityEnabled"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <SwitchInput
                                                    id="dns-authority-enabled"
                                                    label={t(
                                                        "siteDnsAuthorityEnable"
                                                    )}
                                                    defaultChecked={field.value}
                                                    onCheckedChange={(checked: boolean) => {
                                                        field.onChange(checked);
                                                        // Auto-populate publicIp from server's detected IP when enabling
                                                        if (checked && !form.getValues("publicIp")) {
                                                            const defaultIp = site?.publicIp || site?.serverPublicIp || "";
                                                            if (defaultIp) {
                                                                form.setValue("publicIp", defaultIp);
                                                            }
                                                        }
                                                    }}
                                                />
                                            </FormControl>
                                            <FormDescription>
                                                {t(
                                                    "siteDnsAuthorityDescription"
                                                )}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {form.watch("dnsAuthorityEnabled") && (
                                    <FormField
                                        control={form.control}
                                        name="publicIp"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("sitePublicIp")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        value={field.value || ""}
                                                        placeholder={site?.serverPublicIp || t(
                                                            "sitePublicIpPlaceholder"
                                                        )}
                                                        className="flex-1"
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t("sitePublicIpDescription")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>
                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        form="general-settings-form"
                        loading={loading}
                        disabled={loading}
                    >
                        Save All Settings
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
