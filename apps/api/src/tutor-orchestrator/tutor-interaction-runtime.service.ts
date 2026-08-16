import { ConflictException, Injectable } from '@nestjs/common';
import { TutorInteractionRequest } from './tutor-serving.dto';

export type ActiveTutorInteraction = {
  interactionId: string;
  learnerId: string;
  request: TutorInteractionRequest;
  correlationId: string;
  abort: AbortController;
  streaming: boolean;
  terminal: boolean;
};

@Injectable()
export class TutorInteractionRuntimeService {
  private readonly interactions = new Map<string, ActiveTutorInteraction>();
  private readonly requests = new Map<string, string>();

  accept(
    learnerId: string,
    interactionId: string,
    correlationId: string,
    request: TutorInteractionRequest,
  ): ActiveTutorInteraction {
    const requestKey = `${learnerId}:${request.clientRequestId}`;
    const existingId = this.requests.get(requestKey);
    if (existingId) {
      const existing = this.interactions.get(existingId);
      if (
        existing &&
        JSON.stringify(existing.request) === JSON.stringify(request)
      )
        return existing;
      throw new ConflictException({
        code: 'TUTOR_REQUEST_CONFLICT',
        message: 'This Tutor request has already been used.',
      });
    }
    const active: ActiveTutorInteraction = {
      interactionId,
      learnerId,
      request,
      correlationId,
      abort: new AbortController(),
      streaming: false,
      terminal: false,
    };
    this.interactions.set(interactionId, active);
    this.requests.set(requestKey, interactionId);
    return active;
  }

  get(interactionId: string) {
    return this.interactions.get(interactionId);
  }

  begin(active: ActiveTutorInteraction) {
    if (active.streaming || active.terminal) return false;
    active.streaming = true;
    return true;
  }

  cancel(active: ActiveTutorInteraction) {
    if (active.terminal || active.abort.signal.aborted) return false;
    active.abort.abort();
    return true;
  }

  finish(active: ActiveTutorInteraction) {
    active.terminal = true;
    active.streaming = false;
    const timer = setTimeout(() => this.remove(active), 5 * 60_000);
    timer.unref();
  }

  private remove(active: ActiveTutorInteraction) {
    this.interactions.delete(active.interactionId);
    this.requests.delete(
      `${active.learnerId}:${active.request.clientRequestId}`,
    );
  }
}
