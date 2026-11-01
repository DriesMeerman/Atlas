// Demo TL;DR map. See SCHEMA.md for the format.
window.ATLAS_TLDR = {
  intro:
    "A small order service. The API places orders in one transaction with an outbox row; " +
    "jobs take it from there: payment, email and a nightly check against the provider.",
  blocks: [
    {
      id: "in", title: "Requests in", layer: "edge",
      oneLiner: "The HTTP API checks the session, then calls one service function.",
      bullets: [
        "Writes carry an Idempotency-Key, so a client retry returns the first answer.",
        "Rate limits are per account and live in Redis.",
        "Webhooks from the payment provider are stored once, then handled by a job."
      ],
      col: 0, row: 0,
      nodes: ["clients", "gateway", "auth", "webhooks"],
      zoom: { diagram: "checkout", focus: ["clients", "gateway", "auth"] }
    },
    {
      id: "decide", title: "Place the order", layer: "core",
      oneLiner: "Pricing and the state change commit together with an outbox row.",
      bullets: [
        "Totals come from a snapshot, so later price changes never touch a placed order.",
        "Orders move draft, placed, paid, shipped, or to cancelled.",
        "Nothing after the commit runs inside the request."
      ],
      col: 1, row: 0,
      nodes: ["orders", "pricing"],
      zoom: { diagram: "checkout", focus: ["orders", "pricing", "db"] }
    },
    {
      id: "relay", title: "Hand off", layer: "jobs",
      oneLiner: "The outbox relay turns committed rows into queued jobs.",
      bullets: [
        "Rows are claimed with SKIP LOCKED, so relays can run side by side.",
        "A row is marked sent only after the queue accepts it.",
        "Failed jobs back off and end in a dead-letter list after 8 tries."
      ],
      col: 2, row: 0,
      nodes: ["outbox", "queue"],
      zoom: { diagram: "background", focus: ["outbox", "queue", "db"] }
    },
    {
      id: "pay", title: "Get paid", layer: "jobs",
      oneLiner: "A worker asks the provider; the answer comes back by webhook.",
      bullets: [
        "The order id is the idempotency key for every provider call.",
        "Applying the same event twice does nothing."
      ],
      col: 2, row: 1,
      nodes: ["payments", "provider", "webhooks"],
      zoom: { diagram: "payments", focus: ["payments", "provider", "webhooks"] }
    },
    {
      id: "state", title: "Remember", layer: "storage",
      oneLiner: "Postgres holds what must survive; Redis holds what can be rebuilt.",
      bullets: [
        "Orders, outbox rows, webhook events and reports are in Postgres.",
        "Sessions, rate limits and the queue are in Redis.",
        "Losing Redis loses no order: the outbox re-sends unsent rows."
      ],
      col: 0, row: 1, span: 2,
      nodes: ["db", "redis"],
      zoom: { diagram: "overview", focus: ["db", "redis", "outbox"] }
    }
  ],
  links: [
    { from: "in", to: "decide", label: "placeOrder()" },
    { from: "decide", to: "relay", label: "outbox row" },
    { from: "relay", to: "pay", label: "job" },
    { from: "pay", to: "state", label: "markPaid()" }
  ]
};
