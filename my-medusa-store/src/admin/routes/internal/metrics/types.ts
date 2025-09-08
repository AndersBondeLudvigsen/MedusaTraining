export type ToolStats = { total: number; errors: number; avgLatency: number };


export type ToolEvent = {
id: string;
timestamp: number;
tool: string;
args?: any;
result?: any;
success: boolean;
errorMessage?: string;
durationMs?: number;
};


export type Anomaly = {
id: string;
timestamp: number;
type: string;
message: string;
details?: any;
};


export type NumberDelta = { ai: number; tool: number; diff: number; withinTolerance: boolean };


export type ValidationCheck = {
label: string;
ai?: number;
tool?: number;
tolerance?: number;
delta?: NumberDelta;
ok: boolean;
};


export type AssistantTurn = {
id: string;
timestamp: number;
userMessage: any;
assistantMessage?: any;
toolsUsed: string[];
extractedNumbers?: Record<string, number>;
groundedNumbers?: Record<string, number>;
validations: ValidationCheck[];
};


export type AssistantSummary = {
turns: AssistantTurn[];
validation: { total: number; ok: number; fail: number };
};


export type MetricsSummary = {
totals: { totalEvents: number; lastHour: number };
byTool: Record<string, ToolStats>;
rates: {
thisMinute: Record<string, number>;
baselineAvgPerMinute: Record<string, number>;
};
recentEvents: ToolEvent[];
anomalies: Anomaly[];
assistant?: AssistantSummary;
};