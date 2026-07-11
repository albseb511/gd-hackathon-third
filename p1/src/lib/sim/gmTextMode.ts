// Text-mode GM session for the Simulator agent. Runs the SAME narrator system
// prompt and tool declarations as the Live (audio) session, but over plain
// chats.create/sendMessage so we can drive it with synthetic players.
//
// Design: step(playerMessage) sends a user turn and auto-answers "fire and
// forget" tools (render_scene / present_choices / update_state / show_ui /
// end_story) with {ok:true} — no images are actually generated in sim mode.
// Interactive tools (start_qte, skill_check) are returned UNANSWERED as
// `pending`; the caller decides the outcome and calls resolveInteractive(),
// which sends the held functionResponse parts and continues the conversation.

import type { Chat, FunctionCall, Part } from "@google/genai";
import { genai } from "../gemini";
import { MODELS } from "../models";
import {
  buildNarratorSystemPrompt,
  type NarratorPromptOpts,
} from "../storyEngine/systemPrompt";
import { narratorTools, TOOL_NAMES } from "../storyEngine/tools";

export interface GmToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface GmStepResult {
  narration: string;
  toolCalls: GmToolCall[];
  /** Interactive calls (start_qte / skill_check) awaiting resolveInteractive. */
  pending: GmToolCall[];
  /** True once end_story has been called. */
  ended: boolean;
}

const INTERACTIVE_TOOLS = new Set<string>([
  TOOL_NAMES.startQte,
  TOOL_NAMES.skillCheck,
]);

// Safety bound on tool-response round-trips within a single step.
const MAX_TOOL_ROUNDS = 8;

export class GmTextSession {
  private chat: Chat;
  private pendingCalls: GmToolCall[] = [];
  // functionResponse parts held back until all pending interactives resolve
  // (the API wants every functionCall of a model turn answered in ONE turn).
  private heldResponses: Part[] = [];
  ended = false;

  constructor(opts: NarratorPromptOpts) {
    // `behavior: NON_BLOCKING` is a Live-API-only field; strip it for
    // generateContent-based chats.
    const declarations = narratorTools.map((t) => { const d = { ...t }; delete d.behavior; return d; });
    this.chat = genai().chats.create({
      model: MODELS.text,
      config: {
        systemInstruction: buildNarratorSystemPrompt(opts),
        tools: [{ functionDeclarations: declarations }],
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
  }

  async step(playerMessage: string): Promise<GmStepResult> {
    if (this.pendingCalls.length > 0) {
      throw new Error(
        `Cannot step: unresolved interactive call(s) ${this.pendingCalls
          .map((c) => c.name)
          .join(", ")} — call resolveInteractive first.`,
      );
    }
    return this.drive([{ text: playerMessage }]);
  }

  /**
   * Resolve a pending start_qte / skill_check with the caller-decided outcome
   * (sent verbatim as the functionResponse payload). Continues the
   * conversation once every pending call is resolved.
   */
  async resolveInteractive(
    name: string,
    id: string | undefined,
    outcome: Record<string, unknown>,
  ): Promise<GmStepResult> {
    const idx = this.pendingCalls.findIndex(
      (c) => c.name === name && (id === undefined || c.id === id),
    );
    if (idx === -1) {
      throw new Error(`No pending interactive call named "${name}"`);
    }
    const [call] = this.pendingCalls.splice(idx, 1);
    this.heldResponses.push({
      functionResponse: { id: call.id, name: call.name, response: outcome },
    });
    if (this.pendingCalls.length > 0) {
      // Still waiting on siblings from the same model turn.
      return {
        narration: "",
        toolCalls: [],
        pending: [...this.pendingCalls],
        ended: this.ended,
      };
    }
    const parts = this.heldResponses;
    this.heldResponses = [];
    return this.drive(parts);
  }

  /** Full conversation history (for debugging / transcripts). */
  getHistory() {
    return this.chat.getHistory();
  }

  // Send `message`, then keep answering tool calls until the model stops
  // calling tools or an interactive call needs the caller.
  private async drive(message: Part[]): Promise<GmStepResult> {
    let narration = "";
    const toolCalls: GmToolCall[] = [];
    let outgoing: Part[] = message;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.chat.sendMessage({ message: outgoing });

      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .map((p) => p.text ?? "")
        .filter(Boolean)
        .join(" ")
        .trim();
      if (text) narration += (narration ? "\n" : "") + text;

      const calls: FunctionCall[] = res.functionCalls ?? [];
      if (calls.length === 0) break;

      const responses: Part[] = [];
      let sawInteractive = false;
      for (const fc of calls) {
        const call: GmToolCall = {
          name: fc.name ?? "",
          args: (fc.args ?? {}) as Record<string, unknown>,
          id: fc.id,
        };
        toolCalls.push(call);
        if (INTERACTIVE_TOOLS.has(call.name)) {
          sawInteractive = true;
          this.pendingCalls.push(call);
        } else {
          // Sim mode: render_scene et al. are acknowledged, never executed —
          // no images, no UI generation.
          if (call.name === TOOL_NAMES.endStory) this.ended = true;
          responses.push({
            functionResponse: {
              id: fc.id,
              name: call.name,
              response: { ok: true },
            },
          });
        }
      }

      if (sawInteractive) {
        // Hold the auto-acks; the caller resolves the interactive(s), then
        // resolveInteractive ships everything together.
        this.heldResponses.push(...responses);
        break;
      }

      if (this.ended) {
        // Ship the final acks so history stays valid, then stop.
        await this.chat.sendMessage({ message: responses });
        break;
      }

      outgoing = responses;
    }

    return {
      narration,
      toolCalls,
      pending: [...this.pendingCalls],
      ended: this.ended,
    };
  }
}
