import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check, Cpu, Wallet, Activity, Shield, Zap, ExternalLink, Fingerprint, ShieldCheck, Globe, Link } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AgentPage() {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);

  const { data: dashboard, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/agent/dashboard"],
  });

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
    setTimeout(() => setCopied(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <p className="text-sm text-destructive font-medium" data-testid="text-error">Failed to load agent dashboard</p>
          <p className="text-xs text-muted-foreground">Check your connection and try refreshing the page.</p>
        </div>
      </div>
    );
  }

  const identity = dashboard?.identity;
  const stats = dashboard?.serviceStats;
  const selfStatus = dashboard?.selfStatus;
  const openServStatus = dashboard?.openServStatus;
  const logs = dashboard?.recentLogs || [];
  const baseUrl = window.location.origin;

  const curlExample = `curl -X POST ${baseUrl}/api/agent/services/threat-check \\
  -H "Content-Type: application/json" \\
  -d '{"text": "DM me for guaranteed 100x returns on your investment", "paymentId": "your-locus-payment-id"}'`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Master Agent</h1>
        <p className="text-muted-foreground mt-1">Autonomous community protection agent on Base — with proof-of-human identity</p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-foreground flex items-center justify-center">
                <Cpu className="h-5 w-5 text-background" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge variant={dashboard?.isConfigured ? "default" : "secondary"} data-testid="badge-agent-status">
                  {dashboard?.isConfigured ? "Active" : "Not Configured"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-foreground flex items-center justify-center">
                <Activity className="h-5 w-5 text-background" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Requests</p>
                <p className="text-2xl font-bold font-mono" data-testid="text-total-requests">{stats?.totalRequests || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-foreground flex items-center justify-center">
                <Zap className="h-5 w-5 text-background" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Today</p>
                <p className="text-2xl font-bold font-mono" data-testid="text-requests-today">{stats?.requestsToday || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-foreground flex items-center justify-center">
                <Wallet className="h-5 w-5 text-background" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Earnings</p>
                <p className="text-2xl font-bold font-mono" data-testid="text-total-earnings">${stats?.totalEarnings || "0.00"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-foreground flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-background" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Verified</p>
                <p className="text-2xl font-bold font-mono" data-testid="text-verified-requests">{stats?.verifiedRequests || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Agent Identity
            </CardTitle>
            <CardDescription>Public agent manifest for other agents to discover</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm font-medium" data-testid="text-agent-name">{identity?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Version</span>
                <span className="text-sm font-mono">{identity?.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Chain</span>
                <Badge variant="outline">{identity?.chain?.toUpperCase()}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Wallet</span>
                <span className="text-xs font-mono truncate max-w-[200px]" data-testid="text-wallet-address">
                  {identity?.walletAddress || "Not configured"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Wallet Status</span>
                <Badge variant={identity?.walletStatus === "deployed" ? "default" : "secondary"}>
                  {identity?.walletStatus || "N/A"}
                </Badge>
              </div>
            </div>
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground mb-2">Identity Endpoint</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted p-2 flex-1 truncate font-mono">{identity?.endpoints?.identity}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => handleCopy(identity?.endpoints?.identity || "", "Endpoint")}
                  data-testid="button-copy-identity-url"
                >
                  {copied === "Endpoint" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4" />
              Self Protocol — Proof of Human
            </CardTitle>
            <CardDescription>On-chain verified identity via Self Protocol on Celo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={selfStatus?.verified ? "default" : "secondary"} data-testid="badge-self-status">
                  {selfStatus?.verified ? "Verified" : selfStatus?.configured ? "Registered" : "Not Configured"}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Chain</span>
                <Badge variant="outline">{selfStatus?.chain?.toUpperCase() || "CELO"}</Badge>
              </div>
              {selfStatus?.agentId && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Agent Address</span>
                  <span className="text-xs font-mono truncate max-w-[180px]" data-testid="text-self-agent-id">
                    {selfStatus.agentId}
                  </span>
                </div>
              )}
            </div>
            <div className="pt-2 border-t space-y-2">
              <p className="text-xs text-muted-foreground">
                Self-verified calling agents receive trust-tier benefits: 50% pricing discount, higher rate limits (60/min vs 30/min), and discounted AI tier access.
              </p>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Verified requests</span>
                <span className="font-mono font-medium" data-testid="text-verified-count">{stats?.verifiedRequests || 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Unverified requests</span>
                <span className="font-mono" data-testid="text-unverified-count">{stats?.unverifiedRequests || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Services & Pricing
            </CardTitle>
            <CardDescription>Agent-to-agent paid services via Locus on Base</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {identity?.pricing && Object.entries(identity.pricing).map(([key, pricing]: [string, any]) => {
              const trustPricing = identity?.trustTierPricing?.[key];
              return (
                <div key={key} className="p-3 border bg-muted/30">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium">{key}</span>
                    <Badge variant="outline" className="font-mono">{pricing.price} {pricing.currency}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{pricing.description}</p>
                  {trustPricing && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Fingerprint className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Trust tier: {trustPricing.price} {trustPricing.currency}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              OpenServ Marketplace
            </CardTitle>
            <CardDescription>Multi-agent platform listing for discoverability</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={openServStatus?.configured ? "default" : "outline"} data-testid="badge-openserv-status">
                  {openServStatus?.configured ? "Active" : "Not Configured"}
                </Badge>
              </div>
              {openServStatus?.configured && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Invocations</span>
                  <span className="text-sm font-mono" data-testid="text-openserv-invocations">{openServStatus.totalInvocations || 0}</span>
                </div>
              )}
            </div>
            {openServStatus?.capabilities && openServStatus.capabilities.length > 0 && (
              <div className="pt-2 border-t space-y-2">
                <p className="text-xs text-muted-foreground">Registered capabilities</p>
                <div className="flex flex-wrap gap-1.5">
                  {openServStatus.capabilities.map((cap: string) => (
                    <Badge key={cap} variant="outline" className="text-xs font-mono" data-testid={`badge-cap-${cap}`}>
                      {cap}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                {openServStatus?.configured
                  ? "TeliGent is available on the OpenServ multi-agent marketplace. Other agents can discover and invoke threat detection capabilities directly."
                  : "Set OPENSERV_API_KEY to register on the OpenServ marketplace and make TeliGent's capabilities discoverable to other agents."}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link className="h-4 w-4" />
              ERC-8004 — On-chain Identity
            </CardTitle>
            <CardDescription>Verifiable agent identity anchored on-chain via ERC-8004</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Standard</span>
                <Badge variant="default" data-testid="badge-erc8004-standard">ERC-8004</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Chain</span>
                <Badge variant="outline">{identity?.erc8004?.chain?.toUpperCase() || "BASE"}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Mint Status</span>
                <Badge variant={identity?.erc8004?.mintStatus === "minted" ? "default" : "secondary"} data-testid="badge-erc8004-status">
                  {identity?.erc8004?.mintStatus === "minted" ? "Minted" : "Pending"}
                </Badge>
              </div>
              {identity?.erc8004?.contractAddress && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Contract</span>
                  <span className="text-xs font-mono truncate max-w-[180px]" data-testid="text-erc8004-contract">{identity.erc8004.contractAddress}</span>
                </div>
              )}
              {identity?.erc8004?.tokenId && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Token ID</span>
                  <span className="text-xs font-mono" data-testid="text-erc8004-token">{identity.erc8004.tokenId}</span>
                </div>
              )}
            </div>
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground mb-2">Registration File</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted p-2 flex-1 truncate font-mono" data-testid="text-erc8004-url">{identity?.erc8004?.registrationUrl || `${baseUrl}/api/agent/erc8004/registration`}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => handleCopy(identity?.erc8004?.registrationUrl || `${baseUrl}/api/agent/erc8004/registration`, "ERC-8004")}
                  data-testid="button-copy-erc8004-url"
                >
                  {copied === "ERC-8004" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(identity?.erc8004?.registrationUrl || `${baseUrl}/api/agent/erc8004/registration`, "_blank")}
                data-testid="button-view-erc8004"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                View Registration JSON
              </Button>
            </div>
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                ERC-8004 is an ERC-721 based standard for trustless agent identity, reputation, and validation. The registration file describes capabilities, endpoints, and trust models. Mint as an NFT to anchor this identity on-chain.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Try It — Threat Check API</CardTitle>
          <CardDescription>Test the agent's scam detection service (requires Locus payment)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted p-4 overflow-x-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap" data-testid="text-curl-example">{curlExample}</pre>
          </div>
          <div className="flex gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCopy(curlExample, "curl")}
              data-testid="button-copy-curl"
            >
              {copied === "curl" ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${baseUrl}/api/agent/identity`, "_blank")}
              data-testid="button-view-identity"
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              View Identity JSON
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Self-verified agents can include x-self-agent-address, x-self-agent-signature, and x-self-agent-timestamp headers for trust-tier pricing.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Service Activity</CardTitle>
          <CardDescription>Log of agent-to-agent service requests</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-logs">
              No service requests yet. Use the API endpoints above to get started.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {logs.map((log: any) => (
                <div key={log.id} className="flex items-center justify-between p-3 border bg-muted/20 text-sm" data-testid={`row-log-${log.id}`}>
                  <div className="flex items-center gap-3">
                    <Badge variant={log.isScam ? "destructive" : "secondary"} className="text-xs">
                      {log.isScam ? "THREAT" : "CLEAN"}
                    </Badge>
                    <span className="font-mono text-xs">{log.service}</span>
                    {log.selfVerified && (
                      <Fingerprint className="h-3 w-3 text-muted-foreground" title="Self-verified agent" />
                    )}
                    <span className="text-muted-foreground text-xs truncate max-w-[200px]">{log.reason}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant="outline" className="font-mono text-xs">{log.pricingTier}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
