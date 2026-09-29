export type NiwaSettings = { model: string; effort: string; voiceMode: 'realtime' | 'local'; voice: string; access: 'read' | 'workspace' | 'full'; cwd: string };
export type NiwaMessage = { id: string; role: string; content: string; timestamp: number };
export type NiwaModel = { model: string; displayName: string; defaultReasoningEffort: string; supportedReasoningEfforts: { reasoningEffort: string }[] };
export type NiwaApproval = { id: string; title: string; detail?: string; questions?: { id: string; header: string; question: string; options?: { label: string; description: string }[] }[] };
export type NiwaMemory = { active_facts: number; documents: Record<string, { id: string; fact: string }[]> };
export type NiwaSnapshot = { settings: NiwaSettings; voices: string[]; browser: { mode: 'chrome' | 'bundled'; connected: boolean }; messages: NiwaMessage[]; models: NiwaModel[]; memory: NiwaMemory; connectors: { id: string; enabled: boolean; transport: string }[]; busy: boolean; voice: boolean; approvals: NiwaApproval[] };
export type NiwaEvent = { type: string; settings?: NiwaSettings; id?: string; role?: string; content?: string; timestamp?: number; text?: string; message?: string; sdp?: string; busy?: boolean; active?: boolean; title?: string; detail?: string; questions?: NiwaApproval['questions'] };

// Capture is independent of the receive-capable WebRTC conversation.
export class NiwaVoice {
  private peer: RTCPeerConnection | null = null;
  private sender: RTCRtpSender | null = null;
  private stream: MediaStream | null = null;
  private audio = new Audio();
  private generation = 0;
  private microphoneGeneration = 0;
  private microphoneEnabled = false;
  private microphoneActive = false;
  private microphoneTask: Promise<void> | null = null;
  private replacement: Promise<void> | null = null;
  private backendTask: Promise<void> = Promise.resolve();
  private backendGeneration: number | null = null;

  constructor(private failure: (message: string) => void, private captureChanged?: (active: boolean) => void) {
    this.audio.autoplay = true;
  }

  start(): Promise<void> {
    const enabled = this.microphoneEnabled;
    this.close();
    this.microphoneEnabled = enabled;
    const generation = this.generation;
    return this.sessionOperation(generation, this.startPeer(generation));
  }

  private async startPeer(generation: number): Promise<void> {
    const peer = this.peer = new RTCPeerConnection();
    const current = () => generation === this.generation && this.peer === peer;
    this.sender = peer.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    peer.ontrack = event => {
      if (!current()) return;
      this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void this.audio.play().catch(error => { if (current()) this.report(error); });
    };
    peer.onconnectionstatechange = () => {
      if (current() && peer.connectionState === 'failed') {
        this.failSession(generation, new Error('Voice connection failed. Reconnect to continue.'));
      }
    };
    peer.createDataChannel('oai-events');
    // A permission prompt must not block incoming audio negotiation.
    if (this.microphoneEnabled) void this.setMicrophoneEnabled(true);
    const offer = await peer.createOffer();
    if (!current()) return;
    await peer.setLocalDescription(offer);
    if (!current()) return;
    const sdp = peer.localDescription!.sdp;
    await this.queueBackend(async () => {
      if (!current()) return;
      if (this.backendGeneration !== null) await this.stopBackend(this.backendGeneration);
      if (!current()) return;
      this.backendGeneration = generation;
      try { await window.localflow.niwaStartVoice(sdp); }
      finally {
        // Backend calls have no session ID: finish old cleanup before a new start.
        if (!current()) await this.stopBackend(generation);
      }
    });
  }

  answer(sdp: string): Promise<void> {
    const generation = this.generation;
    const peer = this.peer;
    return this.sessionOperation(generation, (async () => {
      if (peer?.signalingState === 'have-local-offer') await peer.setRemoteDescription({ type: 'answer', sdp });
    })());
  }

  setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.microphoneEnabled = enabled;
    if (enabled && (this.microphoneTask || this.stream)) return this.microphoneTask ?? Promise.resolve();
    const microphoneGeneration = ++this.microphoneGeneration;
    const generation = this.generation;
    const sender = this.sender;
    const currentPeer = () => generation === this.generation && sender === this.sender;
    const currentHold = () => currentPeer() && microphoneGeneration === this.microphoneGeneration && this.microphoneEnabled;
    if (!enabled) {
      this.microphoneTask = null;
      // Stop all capture synchronously, even if an earlier replaceTrack is pending.
      this.stopCapture();
    }
    if (!sender) return Promise.resolve();
    const operation = enabled
      ? this.acquireMicrophone(sender, currentHold)
      : this.replaceInput(sender, null, currentPeer);
    const task = operation.catch(error => {
      if (!currentPeer() || microphoneGeneration !== this.microphoneGeneration) return;
      this.microphoneEnabled = false;
      this.microphoneGeneration++;
      this.stopCapture();
      if (enabled) void this.replaceInput(sender, null, currentPeer).catch(error => { if (currentPeer()) this.report(error); });
      this.report(error);
      throw error;
    });
    if (enabled) this.microphoneTask = task;
    const finished = () => { if (this.microphoneTask === task) this.microphoneTask = null; };
    // Observe rejected promises even when called with `void` from a hotkey handler.
    void task.then(finished, finished);
    return task;
  }

  private async acquireMicrophone(sender: RTCRtpSender, current: () => boolean): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!current()) { this.stopTracks(stream); return; }
    const track = stream.getAudioTracks().find(track => track.readyState === 'live');
    if (!track) { this.stopTracks(stream); throw new Error('No live microphone audio track is available.'); }
    this.stream = stream;
    for (const input of stream.getTracks()) {
      input.onended = () => { if (current()) void this.setMicrophoneEnabled(false); };
      input.onmute = input.onunmute = () => { if (current()) this.updateCapture(); };
    }
    // Capture begins when getUserMedia resolves, not when replaceTrack settles.
    this.updateCapture();
    await this.replaceInput(sender, track, current);
  }

  private replaceInput(sender: RTCRtpSender, track: MediaStreamTrack | null, current: () => boolean): Promise<void> {
    const replace = async () => { if (current()) await sender.replaceTrack(track); };
    const task = this.replacement ? this.replacement.then(replace, replace) : replace();
    this.replacement = task;
    const finished = () => { if (this.replacement === task) this.replacement = null; };
    void task.then(finished, finished);
    return task;
  }

  private stopTracks(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      track.onended = track.onmute = track.onunmute = null;
      track.enabled = false;
      track.stop();
    }
  }

  private stopCapture() {
    const stream = this.stream;
    this.stream = null;
    if (stream) this.stopTracks(stream);
    this.updateCapture();
  }

  private updateCapture() {
    const active = this.stream?.getAudioTracks().some(track => track.enabled && !track.muted && track.readyState === 'live') ?? false;
    if (active !== this.microphoneActive) {
      this.microphoneActive = active;
      this.captureChanged?.(active);
    }
  }

  private report(error: unknown) { this.failure(error instanceof Error ? error.message : String(error)); }

  private queueBackend(work: () => Promise<void>): Promise<void> {
    const task = this.backendTask.then(work);
    this.backendTask = task.catch(() => {});
    return task;
  }

  private async stopBackend(generation: number): Promise<void> {
    if (this.backendGeneration !== generation) return;
    this.backendGeneration = null;
    try { await window.localflow.niwaStopVoice(); }
    catch (error) { this.report(error); }
  }

  private failSession(generation: number, error: unknown) {
    if (generation !== this.generation) return;
    this.close();
    void this.queueBackend(() => this.stopBackend(generation));
    this.report(error);
  }

  private sessionOperation(generation: number, operation: Promise<void>): Promise<void> {
    const task = operation.catch(error => {
      if (generation !== this.generation) return;
      this.failSession(generation, error);
      throw error;
    });
    // Preserve await/catch semantics without unhandled event-handler rejections.
    void task.catch(() => {});
    return task;
  }

  close() {
    this.generation++;
    this.microphoneGeneration++;
    this.microphoneEnabled = false;
    this.microphoneTask = null;
    this.stopCapture();
    this.sender = null;
    this.replacement = null;
    if (this.peer) {
      this.peer.ontrack = null;
      this.peer.onconnectionstatechange = null;
      this.peer.close();
      this.peer = null;
    }
    this.audio.pause();
    this.audio.srcObject = null;
  }
}
