import { useState, useEffect, useCallback } from "react";
import { Sparkles, Loader2, Check, Eye, EyeOff, RotateCcw, ChevronLeft, ChevronRight, History } from "lucide-react";
import type { AppNode, LabeledEdge } from "@/store/flow-store";
import { useFlowStore } from "@/store/flow-store";
import {
  callAiBeautify,
  computeDiff,
  applyResult,
  saveAiConfig,
  loadAiConfig,
  addLlmHistory,
  loadLlmHistory,
  maskApiKey,
  type AiConfig,
  type BeautifyDiffEntry,
  type LlmCallRecord,
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
  | { type: "ready" }
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

  const [status, setStatus] = useState<Status>({ type: "ready" });
  const [showDetails, setShowDetails] = useState(true);
  const [currentNodes, setCurrentNodes] = useState(nodes);
  const [currentEdges, setCurrentEdges] = useState(edges);
  const [beautifyResult, setBeautifyResult] = useState<{
    nodes: AppNode[];
    edges: LabeledEdge[];
  } | null>(null);
  const [llmHistory, setLlmHistory] = useState<LlmCallRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const HISTORY_PAGE_SIZE = 5;

  // When dialog opens, snapshot current state but don't call API
  useEffect(() => {
    if (open) {
      setCurrentNodes(nodes);
      setCurrentEdges(edges);
      setBeautifyResult(null);
      setShowConfig(false);
      setPreviewActive(false);

      const config = loadAiConfig();
      const saved = loadLlmHistory();
      setLlmHistory(saved);
      setHistoryPage(0);
      setHistoryOpen(saved.length > 0);
      setStatus(config ? { type: "ready" } : { type: "config" });
    }
  }, [open]);

  const runBeautify = useCallback(
    async (config: AiConfig, n: AppNode[], e: LabeledEdge[]) => {
      setStatus({ type: "loading" });
      try {
        const result = await callAiBeautify(config, n, e);
        const diffs = computeDiff(n, e, result);
        const record: LlmCallRecord = {
          id: `llm${Date.now().toString(36)}`,
          timestamp: Date.now(),
          endpoint: config.endpoint,
          model: config.model,
          apiKeyPrefix: maskApiKey(config.apiKey),
        };
        addLlmHistory(record);
        setLlmHistory((prev) => [record, ...prev]);
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

  const handleStart = () => {
    const config = loadAiConfig();
    if (config) {
      runBeautify(config, currentNodes, currentEdges);
    } else {
      setStatus({ type: "config" });
    }
  };

  const handleUseHistoryConfig = (record: LlmCallRecord) => {
    saveAiConfig({
      endpoint: record.endpoint,
      apiKey: "", // masked key is read-only, user must re-enter
      model: record.model,
    });
    setStatus({ type: "config" });
  };

  const handleRetry = () => {
    const config = loadAiConfig();
    if (config) {
      runBeautify(config, currentNodes, currentEdges);
    } else {
      setStatus({ type: "config" });
    }
  };

  const handleTogglePreview = useCallback(() => {
    if (!beautifyResult) return;
    if (previewActive) {
      replace({ nodes: currentNodes, edges: currentEdges });
      setPreviewActive(false);
    } else {
      replace({ nodes: beautifyResult.nodes, edges: beautifyResult.edges });
      setPreviewActive(true);
    }
  }, [beautifyResult, previewActive, currentNodes, currentEdges, replace]);

  const handleApply = () => {
    if (!beautifyResult) return;
    if (!previewActive) {
      replace({
        nodes: beautifyResult.nodes,
        edges: beautifyResult.edges,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v && previewActive && beautifyResult) {
        replace({ nodes: currentNodes, edges: currentEdges });
      }
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Beautify
          </DialogTitle>
          <DialogDescription>
            {status.type === "loading" && "Optimizing diagram layout..."}
            {status.type === "ready" && "Click start to beautify the current diagram layout."}
            {status.type === "preview" && "Review the changes below before applying."}
            {status.type === "error" && "Something went wrong."}
            {status.type === "config" && "Configure your AI provider first."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[120px] py-2">
          {status.type === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">Sending request to LLM...</span>
              <span className="text-xs opacity-60">
                {loadAiConfig()?.model ?? "unknown model"}
                {" · "}
                {currentNodes.length} nodes, {currentEdges.length} edges
              </span>
            </div>
          )}

          {status.type === "ready" && (
            <div className="flex flex-col gap-4 py-3">
              {/* Config bar */}
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div className="min-w-0 flex-1 text-xs">
                  {(() => {
                    const c = loadAiConfig();
                    return c ? (
                      <>
                        <span className="font-medium text-foreground">{c.model}</span>
                        <span className="ml-2 text-muted-foreground">{c.endpoint}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No API config set</span>
                    );
                  })()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfig((v) => !v)}
                  className="shrink-0 text-xs"
                >
                  {showConfig ? "Done" : "Config"}
                </Button>
              </div>

              {showConfig && (
                <div className="rounded-md border border-border p-3">
                  <AiConfigInline onDone={() => setShowConfig(false)} />
                </div>
              )}

              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {currentNodes.length} nodes, {currentEdges.length} edges
                </p>
                <Button onClick={handleStart} size="default" className="gap-2">
                  <Sparkles className="h-5 w-5" />
                  Start Beautify
                </Button>
              </div>

              {llmHistory.length > 0 && (
                <div className="w-full pt-1">
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((v) => !v)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <History className="h-3.5 w-3.5" />
                    LLM Calls ({llmHistory.length})
                    <ChevronRight
                      className={`ml-auto h-3.5 w-3.5 transition-transform ${historyOpen ? "rotate-90" : ""}`}
                    />
                  </button>

                  {historyOpen && (
                    <div className="mt-2 space-y-1">
                      {llmHistory
                        .slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE)
                        .map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => handleUseHistoryConfig(r)}
                            className="w-full rounded-md border border-border px-3 py-2 text-left text-xs transition-colors hover:border-indigo-300 hover:bg-indigo-50 dark:hover:border-indigo-700 dark:hover:bg-indigo-950"
                          >
                            <div className="flex items-center justify-between text-muted-foreground">
                              <span>{new Date(r.timestamp).toLocaleString()}</span>
                              <span className="font-mono font-medium text-foreground">{r.model}</span>
                            </div>
                            <p className="mt-0.5 truncate" title={r.endpoint}>
                              {r.endpoint}
                            </p>
                            <p className="font-mono text-muted-foreground">{r.apiKeyPrefix}</p>
                          </button>
                        ))}
                      {llmHistory.length > HISTORY_PAGE_SIZE && (
                        <div className="flex items-center justify-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={historyPage === 0}
                            onClick={() => setHistoryPage((p) => p - 1)}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {historyPage + 1} / {Math.ceil(llmHistory.length / HISTORY_PAGE_SIZE)}
                          </span>
                          <button
                            type="button"
                            disabled={(historyPage + 1) * HISTORY_PAGE_SIZE >= llmHistory.length}
                            onClick={() => setHistoryPage((p) => p + 1)}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
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
            <AiConfigInline onDone={() => setStatus({ type: "ready" })} />
          )}

          {status.type === "preview" && (
            <div className="space-y-3">
              {status.summary && (
                <p className="text-sm text-muted-foreground">{status.summary}</p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant={previewActive ? "default" : "outline"}
                  size="sm"
                  onClick={handleTogglePreview}
                  className="gap-1.5"
                >
                  {previewActive ? (
                    <RotateCcw className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {previewActive ? "Revert" : "Preview"}
                </Button>
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
