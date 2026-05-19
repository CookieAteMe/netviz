import { useState, useEffect, useCallback } from "react";
import { Sparkles, Loader2, Check, Eye, EyeOff } from "lucide-react";
import type { AppNode, LabeledEdge } from "@/store/flow-store";
import { useFlowStore } from "@/store/flow-store";
import {
  callAiBeautify,
  computeDiff,
  applyResult,
  saveAiConfig,
  loadAiConfig,
  type AiConfig,
  type BeautifyDiffEntry,
} from "@/lib/ai-beautify";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";

// ---------------------------------------------------------------------------
// AI Config Dialog
// ---------------------------------------------------------------------------

export function AiConfigDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const saved = loadAiConfig();
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? "");
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [model, setModel] = useState(saved?.model ?? "");

  useEffect(() => {
    if (open) {
      const s = loadAiConfig();
      setEndpoint(s?.endpoint ?? "");
      setApiKey(s?.apiKey ?? "");
      setModel(s?.model ?? "");
    }
  }, [open]);

  const handleSave = () => {
    saveAiConfig({ endpoint: endpoint.trim(), apiKey: apiKey.trim(), model: model.trim() });
    onOpenChange(false);
  };

  const canSave = endpoint.trim() && apiKey.trim() && model.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI Configuration</DialogTitle>
          <DialogDescription>
            Set up an OpenAI-compatible API endpoint for AI beautify.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ai-endpoint">API Endpoint</Label>
            <Input
              id="ai-endpoint"
              placeholder="https://api.openai.com/v1/chat/completions"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-key">API Key</Label>
            <Input
              id="ai-key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              placeholder="gpt-4o, deepseek-chat, etc."
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Beautify Preview Dialog
// ---------------------------------------------------------------------------

type Status =
  | { type: "config" }
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "preview"; diffs: BeautifyDiffEntry[]; summary?: string };

export function AiBeautifyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const replace = useFlowStore((s) => s.replace);

  const [status, setStatus] = useState<Status>({ type: "config" });
  const [showDetails, setShowDetails] = useState(true);
  const [currentNodes, setCurrentNodes] = useState(nodes);
  const [currentEdges, setCurrentEdges] = useState(edges);
  const [beautifyResult, setBeautifyResult] = useState<{
    nodes: AppNode[];
    edges: LabeledEdge[];
  } | null>(null);

  // When dialog opens, snapshot current state
  useEffect(() => {
    if (open) {
      setCurrentNodes(nodes);
      setCurrentEdges(edges);
      setBeautifyResult(null);

      const config = loadAiConfig();
      if (config) {
        setStatus({ type: "loading" });
        runBeautify(config, nodes, edges);
      } else {
        setStatus({ type: "config" });
      }
    }
  }, [open]);

  const runBeautify = useCallback(
    async (config: AiConfig, n: AppNode[], e: LabeledEdge[]) => {
      setStatus({ type: "loading" });
      try {
        const result = await callAiBeautify(config, n, e);
        const diffs = computeDiff(n, e, result);
        setStatus({ type: "preview", diffs, summary: result.summary });
        const applied = applyResult(n, e, result);
        setBeautifyResult(applied);
      } catch (err) {
        setStatus({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    []
  );

  const handleRetry = () => {
    const config = loadAiConfig();
    if (config) {
      runBeautify(config, currentNodes, currentEdges);
    } else {
      setStatus({ type: "config" });
    }
  };

  const handleApply = () => {
    if (!beautifyResult) return;
    replace({
      nodes: beautifyResult.nodes,
      edges: beautifyResult.edges,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Beautify
          </DialogTitle>
          <DialogDescription>
            {status.type === "loading" && "Optimizing diagram layout..."}
            {status.type === "preview" && "Review the changes below before applying."}
            {status.type === "error" && "Something went wrong."}
            {status.type === "config" && "Configure your AI provider first."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[120px] py-2">
          {status.type === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">Calling AI API...</span>
            </div>
          )}

          {status.type === "error" && (
            <div className="space-y-3 py-2">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {status.message}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleRetry}>
                  Retry
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatus({ type: "config" })}
                >
                  Change config
                </Button>
              </div>
            </div>
          )}

          {status.type === "config" && (
            <AiConfigInline onDone={() => handleRetry()} />
          )}

          {status.type === "preview" && (
            <div className="space-y-3">
              {status.summary && (
                <p className="text-sm text-muted-foreground">{status.summary}</p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDetails((v) => !v)}
                  className="gap-1.5"
                >
                  {showDetails ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {showDetails ? "Hide details" : "Show details"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {status.diffs.length} change{status.diffs.length !== 1 ? "s" : ""}
                </span>
              </div>

              {showDetails && status.diffs.length > 0 && (
                <div className="max-h-[300px] space-y-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-2">
                  {status.diffs.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded px-2 py-1 text-xs font-mono"
                    >
                      <span className="mt-0.5 shrink-0 text-emerald-500">+</span>
                      <span className="shrink-0 text-muted-foreground">
                        {d.nodeId ?? d.edgeId}
                      </span>
                      <span className="shrink-0 text-muted-foreground">/</span>
                      <span className="shrink-0 font-semibold text-foreground">
                        {d.field}
                      </span>
                      {d.field === "position" ? (
                        <span className="text-muted-foreground">
                          {JSON.stringify(d.from)} → {JSON.stringify(d.to)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {String(d.from ?? "none")} → {String(d.to ?? "none")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {status.diffs.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-4 text-muted-foreground">
                  <Check className="h-8 w-8 text-emerald-500" />
                  <span className="text-sm">No changes needed — diagram already looks good!</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {status.type === "preview" && status.diffs.length > 0 && (
            <Button onClick={handleApply}>
              <Check className="mr-1.5 h-4 w-4" />
              Apply changes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Inline config form (shown when no config is saved yet)
// ---------------------------------------------------------------------------

function AiConfigInline({ onDone }: { onDone: () => void }) {
  const [endpoint, setEndpoint] = useState("https://api.openai.com/v1/chat/completions");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");

  const handleSave = () => {
    saveAiConfig({
      endpoint: endpoint.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
    });
    onDone();
  };

  const canSave = endpoint.trim() && apiKey.trim() && model.trim();

  return (
    <div className="grid gap-3 py-1">
      <div className="grid gap-1.5">
        <Label htmlFor="ai-ep-inline">API Endpoint</Label>
        <Input
          id="ai-ep-inline"
          placeholder="https://api.openai.com/v1/chat/completions"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ai-key-inline">API Key</Label>
        <Input
          id="ai-key-inline"
          type="password"
          placeholder="sk-..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ai-model-inline">Model</Label>
        <Input
          id="ai-model-inline"
          placeholder="gpt-4o, deepseek-chat, etc."
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </div>
      <div className="flex justify-end pt-1">
        <Button onClick={handleSave} disabled={!canSave}>
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
