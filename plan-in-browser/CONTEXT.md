# AI Skills

This context names the concepts used by skills that add focused capabilities to an AI coding agent.

## Language

**Planning session**:
A durable planning conversation comprising decisions and planning artifacts exchanged between an agent and a person through a browser canvas. It remains recoverable until it is closed or cancelled.
_Avoid_: Canvas session, browser session

**Cancellation**:
The person's terminal decision to stop a planning session without completing it. Cancellation remains the session's outcome even when its runtime is subsequently stopped.

**Closure**:
The agent's terminal disposal of a completed planning session.
