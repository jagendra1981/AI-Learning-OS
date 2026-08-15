import { TutorStreamEvent } from './api';

export type TutorStreamConnection = { close: () => void };

export function openTutorStream(
  interactionId: string,
  onEvent: (event: TutorStreamEvent) => void,
  onTransportError: () => void,
): TutorStreamConnection {
  const source = new EventSource(
    `/api/tutor/interactions/${encodeURIComponent(interactionId)}/stream`,
    { withCredentials: true },
  );
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as TutorStreamEvent;
      if (!event || event.interactionId !== interactionId) throw new Error();
      onEvent(event);
    } catch {
      source.close();
      onTransportError();
    }
  };
  source.onerror = () => {
    source.close();
    onTransportError();
  };
  return { close: () => source.close() };
}

