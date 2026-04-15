/**
 * Safe Mode — confirmation gate for destructive commands.
 *
 * Commands:
 *   /safe          — toggle safe mode on/off
 *   /safe on|off   — set explicitly
 *
 * Shows a shield indicator in the footer:
 *   🛡 safe   (green, when on)
 *   ⚠ unsafe  (dim, when off)
 *
 * Extend DANGEROUS_PATTERNS at the bottom of this file.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

// ─── Patterns ────────────────────────────────────────────────────────

const DANGEROUS_PATTERNS: { pattern: RegExp; label: string; severity: "warn" | "danger" }[] = [
	// Kubernetes — destructive
	{ pattern: /kubectl\s+delete\b/,                      label: "kubectl delete",             severity: "danger" },
	{ pattern: /kubectl\s+drain\b/,                       label: "kubectl drain node",         severity: "danger" },
	{ pattern: /kubectl\s+cordon\b/,                      label: "kubectl cordon",             severity: "warn"   },
	{ pattern: /kubectl\s+patch\b/,                       label: "kubectl patch",              severity: "warn"   },
	{ pattern: /kubectl\s+scale\b.*--replicas=0\b/,       label: "kubectl scale to 0",         severity: "danger" },
	{ pattern: /kubectl\s+rollout\s+restart\b/,           label: "kubectl rollout restart",    severity: "warn"   },
	{ pattern: /kubectl\s+exec\b/,                        label: "kubectl exec",               severity: "warn"   },
	{ pattern: /kubectl\s+replace\b/,                     label: "kubectl replace",            severity: "warn"   },
	{ pattern: /kubectl\s+apply\b/,                       label: "kubectl apply",              severity: "warn"   },
	{ pattern: /kubectl.*--namespace=kube-system\b/,      label: "kubectl on kube-system",     severity: "danger" },
	{ pattern: /kubectl.*-n\s+kube-system\b/,             label: "kubectl on kube-system",     severity: "danger" },
	{ pattern: /kubectl.*--all-namespaces\b/,             label: "kubectl across all namespaces", severity: "warn" },

	// Helm
	{ pattern: /helm\s+uninstall\b/,                      label: "helm uninstall",             severity: "danger" },
	{ pattern: /helm\s+delete\b/,                         label: "helm delete",                severity: "danger" },
	{ pattern: /helm\s+upgrade\b/,                        label: "helm upgrade",               severity: "warn"   },
	{ pattern: /helm\s+install\b/,                        label: "helm install",               severity: "warn"   },
	{ pattern: /helm\s+rollback\b/,                       label: "helm rollback",              severity: "warn"   },

	// Terraform / OpenTofu
	{ pattern: /terraform\s+destroy\b/,                   label: "terraform destroy",          severity: "danger" },
	{ pattern: /tofu\s+destroy\b/,                        label: "tofu destroy",               severity: "danger" },
	{ pattern: /terraform\s+apply\b/,                     label: "terraform apply",            severity: "warn"   },
	{ pattern: /tofu\s+apply\b/,                          label: "tofu apply",                 severity: "warn"   },

	// AWS CLI
	{ pattern: /aws\s+\S+\s+delete\b/,                    label: "aws delete",                 severity: "danger" },
	{ pattern: /aws\s+\S+\s+terminate\b/,                 label: "aws terminate",              severity: "danger" },
	{ pattern: /aws\s+\S+\s+remove\b/,                    label: "aws remove",                 severity: "danger" },
	{ pattern: /aws\s+s3\s+rm\b/,                         label: "aws s3 rm",                  severity: "danger" },
	{ pattern: /aws\s+s3\s+sync\b/,                       label: "aws s3 sync",                severity: "warn"   },
	{ pattern: /aws\s+ec2\s+terminate-instances\b/,       label: "aws terminate instances",    severity: "danger" },
	{ pattern: /aws\s+rds\s+delete\b/,                    label: "aws rds delete",             severity: "danger" },
	{ pattern: /aws\s+eks\s+delete\b/,                    label: "aws eks delete",             severity: "danger" },
	{ pattern: /aws\s+iam\s+(delete|detach|remove)\b/,    label: "aws iam destructive",        severity: "danger" },
	{ pattern: /aws\s+cloudformation\s+delete\b/,         label: "aws cloudformation delete",  severity: "danger" },

	// GCloud
	{ pattern: /gcloud\s+\S+\s+delete\b/,                 label: "gcloud delete",              severity: "danger" },
	{ pattern: /gcloud\s+container\s+clusters\s+delete\b/,label: "gcloud delete cluster",      severity: "danger" },
	{ pattern: /gcloud\s+sql\s+instances\s+delete\b/,     label: "gcloud sql delete",          severity: "danger" },

	// Docker / container
	{ pattern: /docker\s+(rm|rmi|system\s+prune)\b/,      label: "docker rm/prune",            severity: "warn"   },
	{ pattern: /docker\s+volume\s+rm\b/,                  label: "docker volume rm",           severity: "danger" },

	// Database
	{ pattern: /DROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i, label: "SQL DROP",                   severity: "danger" },
	{ pattern: /TRUNCATE\s+TABLE\b/i,                     label: "SQL TRUNCATE",               severity: "danger" },
	{ pattern: /DELETE\s+FROM\b/i,                        label: "SQL DELETE",                 severity: "warn"   },

	// General shell
	{ pattern: /rm\s+-[rf]+\s+[^-]/,                      label: "rm -rf",                     severity: "danger" },
	{ pattern: />\s*\/dev\/sd[a-z]/,                      label: "write to block device",      severity: "danger" },
	{ pattern: /dd\s+if=/,                                label: "dd",                         severity: "danger" },
	{ pattern: /mkfs\b/,                                  label: "mkfs",                       severity: "danger" },
	{ pattern: /shred\b/,                                 label: "shred",                      severity: "danger" },
];

// ─── Extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let enabled = true;

	function updateStatus(ctx: { ui: any }) {
		const theme = ctx.ui.theme;
		if (enabled) {
			ctx.ui.setStatus("safe-mode", `${theme.fg("success", "🛡")} ${theme.fg("success", "safe")}`);
		} else {
			ctx.ui.setStatus("safe-mode", `${theme.fg("dim", "⚠")} ${theme.fg("dim", "unsafe")}`);
		}
	}

	// Show status on session start
	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);
	});

	// Toggle command
	pi.registerCommand("safe", {
		description: "Toggle safe mode on/off (confirmation gate for destructive commands)",
		handler: async (args, ctx) => {
			const arg = (args || "").trim().toLowerCase();

			if (arg === "on") {
				enabled = true;
			} else if (arg === "off") {
				enabled = false;
			} else {
				// Toggle
				enabled = !enabled;
			}

			updateStatus(ctx);
			ctx.ui.notify(
				enabled ? "🛡 Safe mode ON — destructive commands require confirmation" : "⚠ Safe mode OFF",
				enabled ? "info" : "warning",
			);
		},
	});

	// Intercept dangerous commands
	pi.on("tool_call", async (event, ctx) => {
		if (!enabled) return;
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command || "";

		for (const { pattern, label, severity } of DANGEROUS_PATTERNS) {
			if (!pattern.test(command)) continue;

			const preview = command.length > 300 ? command.slice(0, 300) + "…" : command;
			const title = severity === "danger" ? `🚨 ${label}` : `⚠️  ${label}`;

			const ok = await ctx.ui.confirm(title, `Allow this command?\n\n${preview}`);

			if (!ok) {
				return { block: true, reason: `Blocked by safe-mode: user declined — ${label}` };
			}

			break; // Only prompt once even if multiple patterns match
		}
	});
}
