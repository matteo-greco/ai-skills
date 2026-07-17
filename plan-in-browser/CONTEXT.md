# AI Skills

This context names the concepts used by skills that add focused capabilities to an AI coding agent.

## Language

**Planning session**:
A durable planning conversation comprising decisions and planning artifacts exchanged between an agent and a person through a browser canvas. It remains recoverable until it is closed or cancelled; runtime inactivity does not change its outcome.
_Avoid_: Canvas session, browser session

**Planning session outcome**:
The terminal disposition of a Planning session: either Cancellation or Closure. Runtime availability is not an outcome.

**Cancellation**:
The person's terminal decision to stop a planning session without completing it. Cancellation remains the session's outcome even when its runtime is subsequently stopped.

**Closure**:
The agent's terminal disposal of a completed planning session.
