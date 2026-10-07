# LocalFlow browser call detection

This optional Chrome/Edge extension detects connected audio WebRTC transports on Google Meet, Zoom web, Microsoft Teams web and WhatsApp web. It does not record, request microphone access, read message text or read page titles. Voice notes that only use MediaRecorder do not trigger a call offer. Site implementations that do not expose RTCPeerConnection in the top page are not detected. Native desktop apps remain available through manual source selection and calendar offers.

For this local build:

1. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
2. Choose **Load unpacked**, then select this folder from the LocalFlow package.
3. In LocalFlow Meetings, create and copy a browser connection code. Open the extension popup, paste it and choose **Connect**. Codes expire after five minutes and can be used once.
4. Reload already open meeting tabs before the next call. The detector must run before the page creates its WebRTC connections.
5. Start a call. A connected incoming and outgoing audio transport can offer transcription. Accepting that offer is still required before any audio is recorded.

The browser extension cannot identify a Windows audio PID directly. LocalFlow selects a browser application only when the native audio inventory is unambiguous; otherwise choose the call application in LocalFlow. Application capture may include other tabs in that browser. This extension does not provide tab-isolated recording or identify individual speakers.

The connection uses an authenticated loopback endpoint bound to `127.0.0.1`. Pairing pins the extension's exact origin. Only call state, packet counts, random call identifiers, the service origin and a structured Google Meet conference ID are sent; no audio or conversation text. LocalFlow uses that conference ID to match a calendar reminder. LocalFlow's disconnect operation revokes the credential. Removing the extension alone does not record anything; stale offers expire when heartbeats stop.

The extension is supplied unpacked for the local build. Publishing signed Chrome Web Store and Edge Add-ons packages requires the product owner's store accounts and review. Installing or enabling it in your browser is a separate user action. Actual service-call behavior still requires browser testing; no real meeting is recorded by the repository tests.
