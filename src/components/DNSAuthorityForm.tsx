"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient } from "@app/lib/api";
import { formatAxiosError } from "@app/lib/api/formatAxiosError";
import { zodResolver } from "@hookform/resolvers/zod";
import { type GetResourceResponse } from "@server/routers/resource";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Info, Globe, Server, AlertTriangle } from "lucide-react";
import { useState } from "react";

interface DNSAuthorityFormProps {
    resource: GetResourceResponse;
    updateResource: (data: Partial<GetResourceResponse>) => void;
}

const dnsAuthoritySchema = z.object({
    dnsAuthorityEnabled: z.boolean(),
    dnsAuthorityTtl: z.number().min(10).max(86400),
    dnsAuthorityRoutingPolicy: z.enum(["failover", "roundrobin", "priority"])
});

type DNSAuthorityFormData = z.infer<typeof dnsAuthoritySchema>;

export function DNSAuthorityForm({ resource, updateResource }: DNSAuthorityFormProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const [isSubmitting, setIsSubmitting] = useState(false);

    const form = useForm<DNSAuthorityFormData>({
        resolver: zodResolver(dnsAuthoritySchema),
        defaultValues: {
            dnsAuthorityEnabled: resource.dnsAuthorityEnabled ?? false,
            dnsAuthorityTtl: resource.dnsAuthorityTtl ?? 60,
            dnsAuthorityRoutingPolicy: (resource.dnsAuthorityRoutingPolicy as "failover" | "roundrobin" | "priority") ?? "failover"
        }
    });

    const dnsAuthorityEnabled = form.watch("dnsAuthorityEnabled");

    const onSubmit = async (data: DNSAuthorityFormData) => {
        setIsSubmitting(true);
        try {
            const res = await api.post(`/resource/${resource.resourceId}`, data);
            if (res.status === 200) {
                updateResource(data);
                toast({
                    title: t("dnsAuthorityUpdated"),
                    description: t("dnsAuthorityUpdatedDescription"),
                });
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e, t("dnsAuthorityUpdateError")),
                variant: "destructive"
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    <div className="flex items-center gap-2">
                        <Globe className="h-5 w-5" />
                        {t("dnsAuthority")}
                    </div>
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("dnsAuthorityDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>

            <SettingsSectionBody>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <SettingsSectionForm>
                            <FormField
                                control={form.control}
                                name="dnsAuthorityEnabled"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center justify-between">
                                        <div className="space-y-0.5">
                                            <FormLabel>
                                                {t("dnsAuthorityEnable")}
                                            </FormLabel>
                                            <FormDescription>
                                                {t("dnsAuthorityEnableDescription")}
                                            </FormDescription>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            {dnsAuthorityEnabled && (
                                <>
                                    <Alert>
                                        <AlertTriangle className="h-4 w-4" />
                                        <AlertDescription>
                                            {t("dnsAuthorityRequirements")}
                                            <ul className="list-disc list-inside mt-2 text-sm">
                                                <li>{t("dnsAuthorityRequirement1")}</li>
                                                <li>{t("dnsAuthorityRequirement2")}</li>
                                                <li>{t("dnsAuthorityRequirement3")}</li>
                                            </ul>
                                        </AlertDescription>
                                    </Alert>

                                    {resource.sso && (
                                        <Alert variant="default" className="border-blue-500/50 bg-blue-500/10">
                                            <Info className="h-4 w-4 text-blue-500" />
                                            <AlertDescription className="text-blue-700 dark:text-blue-300">
                                                <strong>{t("dnsAuthoritySsoNote")}</strong>
                                                <p className="mt-1 text-sm">
                                                    {t("dnsAuthoritySsoDescription")}
                                                </p>
                                            </AlertDescription>
                                        </Alert>
                                    )}

                                    <FormField
                                        control={form.control}
                                        name="dnsAuthorityRoutingPolicy"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    <div className="flex items-center gap-2">
                                                        {t("dnsAuthorityRoutingPolicy")}
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger>
                                                                    <Info className="h-4 w-4 text-muted-foreground" />
                                                                </TooltipTrigger>
                                                                <TooltipContent className="max-w-xs">
                                                                    <p>{t("dnsAuthorityRoutingPolicyTooltip")}</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                </FormLabel>
                                                <Select
                                                    value={field.value}
                                                    onValueChange={field.onChange}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="failover">
                                                            {t("dnsAuthorityPolicyFailover")}
                                                        </SelectItem>
                                                        <SelectItem value="roundrobin">
                                                            {t("dnsAuthorityPolicyRoundRobin")}
                                                        </SelectItem>
                                                        <SelectItem value="priority">
                                                            {t("dnsAuthorityPolicyPriority")}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormDescription>
                                                    {field.value === "failover" && t("dnsAuthorityPolicyFailoverDescription")}
                                                    {field.value === "roundrobin" && t("dnsAuthorityPolicyRoundRobinDescription")}
                                                    {field.value === "priority" && t("dnsAuthorityPolicyPriorityDescription")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="dnsAuthorityTtl"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("dnsAuthorityTtl")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={10}
                                                        max={86400}
                                                        {...field}
                                                        onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t("dnsAuthorityTtlDescription")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <div className="rounded-lg border p-4 space-y-2">
                                        <div className="flex items-center gap-2 font-medium">
                                            <Server className="h-4 w-4" />
                                            {t("dnsAuthorityNsRecords")}
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {t("dnsAuthorityNsRecordsDescription")}
                                        </p>
                                        <div className="bg-muted rounded p-3 font-mono text-sm">
                                            <div>{resource.fullDomain} NS ns1.{resource.fullDomain}</div>
                                            <div>ns1.{resource.fullDomain} A [Your Site Public IP]</div>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {t("dnsAuthorityNsRecordsNote")}
                                        </p>
                                    </div>
                                </>
                            )}
                        </SettingsSectionForm>

                        <Button
                            type="submit"
                            disabled={isSubmitting}
                            loading={isSubmitting}
                        >
                            {t("saveChanges")}
                        </Button>
                    </form>
                </Form>
            </SettingsSectionBody>
        </SettingsSection>
    );
}
