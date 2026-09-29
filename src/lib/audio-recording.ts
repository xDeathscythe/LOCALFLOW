export async function createAudioRecording(onStream: (stream: MediaStream) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  try {
    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    const complete = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { stream.getTracks().forEach((track) => track.stop()); reject(new Error("Audio recording failed")); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        chunks.length = 0;
        if (blob.size) resolve(blob);
        else reject(new Error("Recording did not contain audio data. Check the selected microphone and Windows permissions."));
      };
    });
    // Cancellation may precede the caller awaiting the completed recording.
    void complete.catch(() => {});
    recorder.start(100);
    onStream(stream);
    return {
      complete,
      stop: () => { if (recorder.state !== "inactive") recorder.stop(); },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

export type AudioRecording = Awaited<ReturnType<typeof createAudioRecording>>;
