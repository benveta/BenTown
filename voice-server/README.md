# Indie-VOICE for BenTown

The GitHub project the user selected is a Python Indic-Parler-TTS engine, not a
downloadable mobile voice pack or an HTTP service. This adapter keeps synthesis
on a PC/server and lets the Expo game play the resulting audio. It pins one
friendly, slow Indian English woman voice description and skips the upstream
Gemini voice-description request for each short game line.

## Setup on the computer running the model

1. Clone the selected repository beside `app.py`:

   ```powershell
   git clone https://github.com/IND-Anshuman/Indie-VOICE.git voice-server/Indie-VOICE
   ```

2. Use Python 3.10 or newer in a virtual environment, install
   `voice-server/requirements.txt`, and accept/download the
   `ai4bharat/indic-parler-tts` Hugging Face model. Put a Hugging Face token in
   `voice-server/.env` if Hugging Face requires it for the model download.

3. Start the adapter from `voice-server`:

   ```powershell
   python -m uvicorn app:app --host 0.0.0.0 --port 8765
   ```

   Wait for `/health` to report `ready`; the model loads at server startup and
   needs substantial memory. Keep the server on a trusted private network.

4. Set `EXPO_PUBLIC_INDIE_VOICE_URL` to the server's reachable HTTPS URL (or a
   private-LAN URL during local development) before starting Expo, for example:

   ```powershell
   $env:EXPO_PUBLIC_INDIE_VOICE_URL = 'http://192.168.1.20:8765'
   npx expo start
   ```

   Replace the address with the computer's LAN address. A phone cannot reach
   the computer through `localhost`. Restart Expo after changing the variable.

If the server is not configured or temporarily unavailable, BenTown falls back
to the device's available English speech voice, slowed down. The device voice
may not be female; the Indie-VOICE server is what provides the requested voice.
