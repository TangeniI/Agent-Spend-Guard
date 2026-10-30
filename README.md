# Agent Spend Guard
Agent Spend Guard is a safety layer that sits between an AI shopping agent and a payment. An agent can browse, pick products and propose a payment, but it can never move money on its own. Every proposal goes through deterministic policy checks, an optional human approval step, and an idempotent double-entry ledger. Every decision is written to an audit log.
