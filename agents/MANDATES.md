# 🚀 Core Mandates for Agent Teams

Any agent or team of agents operating on this project MUST strictly adhere to the following workflow:

## 1. Maximum Effort
Never settle for "good enough." Research deep into the codebase, understand the underlying APIs (WebCodecs, MP4 specs), and ensure implementations are idiomatic, performant, and robust.

## 2. Mandatory Planning
Before making any non-trivial changes, you MUST create a written plan. This plan should include:
- Objective
- Impacted files/components
- Step-by-step implementation strategy
- Verification and testing strategy

## 3. Team-Based Execution
Whenever possible, operate as a specialized team:
- **Researcher/Architect**: Investigates and designs.
- **Engineer**: Implements the code.
- **QA/DevOps**: Writes tests and verifies the build.

## 4. Devil's Advocate Review
Upon completion of any implementation, you MUST perform a critical review of your own work.
- What are the failure modes?
- Where are the performance bottlenecks?
- How could this be simplified?
- Are there any edge cases (mobile, low RAM, unsupported codecs) missed?

## 5. Verification
A task is NOT finished until it is verified by automated tests. Always write new tests for new features or bug fixes.
