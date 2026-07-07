import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SLACK_TOKEN = process.env.SLACK_TOKEN;   // xoxc-... token
const SLACK_COOKIE = process.env.SLACK_COOKIE;  // xoxd-... cookie (d= value)

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "search_slack",
    label: "Search Slack",
    description:
      "Search Slack messages using Slack's search API. Returns matching messages with channel, user, text, and timestamp. Supports Slack search modifiers like in:#channel, from:@user, after:YYYY-MM-DD, before:YYYY-MM-DD, and exact phrases in quotes.",
    promptSnippet: "Search Slack messages by keyword, channel, user, or date",
    parameters: Type.Object({
      query: Type.String({
        description:
          'Search query. Supports Slack modifiers: in:#channel, from:@user, after:YYYY-MM-DD, before:YYYY-MM-DD, "exact phrase"',
      }),
      count: Type.Optional(
        Type.Number({
          description: "Max number of results to return (default 10, max 100)",
          minimum: 1,
          maximum: 100,
        })
      ),
    }),

    async execute(toolCallId, params, signal) {
      if (!SLACK_TOKEN || !SLACK_COOKIE) {
        return {
          content: [
            {
              type: "text",
              text: "Error: SLACK_TOKEN and SLACK_COOKIE environment variables must both be set.\n\nExport them before starting pi:\n  export SLACK_TOKEN='xoxc-...'\n  export SLACK_COOKIE='xoxd-...'",
            },
          ],
          isError: true,
          details: {},
        };
      }

      const body = new URLSearchParams();
      body.set("token", SLACK_TOKEN);
      body.set("query", params.query);
      body.set("count", String(params.count ?? 10));
      body.set("highlight", "false");

      let res: Response;
      try {
        res = await fetch("https://slack.com/api/search.messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: `d=${SLACK_COOKIE}`,
          },
          body: body.toString(),
          signal,
        });
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Network error: ${err?.message ?? err}` }],
          isError: true,
          details: {},
        };
      }

      const data = (await res.json()) as any;

      if (!data.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Slack API error: ${data.error}\n\nHint: Make sure your token has the "search:read" User Token scope (xoxp-... tokens, not xoxb-...).`,
            },
          ],
          isError: true,
          details: { slack_error: data.error },
        };
      }

      const messages: any[] = data.messages?.matches ?? [];
      const total: number = data.messages?.total ?? 0;

      if (messages.length === 0) {
        return {
          content: [{ type: "text", text: `No messages found for query: "${params.query}"` }],
          details: { total: 0 },
        };
      }

      const formatted = messages
        .map((m: any) => {
          const ts = new Date(parseFloat(m.ts) * 1000).toLocaleString();
          const channel = m.channel?.name ? `#${m.channel.name}` : m.channel?.id ?? "unknown-channel";
          const user = m.username ?? m.user ?? "unknown-user";
          const permalink = m.permalink ? `\n  🔗 ${m.permalink}` : "";
          return `[${ts}] ${channel} — ${user}:\n  ${m.text}${permalink}`;
        })
        .join("\n\n");

      const header =
        total > messages.length
          ? `Showing ${messages.length} of ${total} results for "${params.query}":\n\n`
          : `${messages.length} result${messages.length === 1 ? "" : "s"} for "${params.query}":\n\n`;

      return {
        content: [{ type: "text", text: header + formatted }],
        details: { returned: messages.length, total },
      };
    },
  });
}
