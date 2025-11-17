import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const GOOGLE_CLOUD_PROJECT = Deno.env.get("GOOGLE_CLOUD_PROJECT");
const GOOGLE_ACCESS_TOKEN = Deno.env.get("GOOGLE_ACCESS_TOKEN");
const GCP_TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// Safer base64 conversion for large audio
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks
  for(let i = 0; i < bytes.length; i += chunkSize){
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
// Create WAV header for PCM audio data
function createWavHeader(dataLength, numChannels = 1, sampleRate = 24000, bitsPerSample = 16) {
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  // RIFF Header
  const encoder = new TextEncoder();
  const riff = encoder.encode('RIFF');
  const wave = encoder.encode('WAVE');
  const fmt = encoder.encode('fmt ');
  const data = encoder.encode('data');
  new Uint8Array(buffer, 0, 4).set(riff);
  view.setUint32(4, 36 + dataLength, true); // ChunkSize
  new Uint8Array(buffer, 8, 4).set(wave);
  new Uint8Array(buffer, 12, 4).set(fmt);
  view.setUint32(16, 16, true); // Subchunk1Size (PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample
  new Uint8Array(buffer, 36, 4).set(data);
  view.setUint32(40, dataLength, true); // Subchunk2Size
  return new Uint8Array(buffer);
}
// Convert raw LINEAR16 audio data to WAV format and encode as base64
function convertLinear16ToWavBase64(linear16Data) {
  // LINEAR16 is 16-bit signed little-endian PCM at 24kHz mono (default for GCP TTS)
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const audioBuffer = Uint8Array.from(atob(linear16Data), (c)=>c.charCodeAt(0));
  const wavHeader = createWavHeader(audioBuffer.length, numChannels, sampleRate, bitsPerSample);
  // Combine header and audio data
  const wavFile = new Uint8Array(wavHeader.length + audioBuffer.length);
  wavFile.set(wavHeader, 0);
  wavFile.set(audioBuffer, wavHeader.length);
  return arrayBufferToBase64(wavFile.buffer);
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    // Check if required environment variables are configured
    if (!GOOGLE_CLOUD_PROJECT) {
      console.error("GOOGLE_CLOUD_PROJECT environment variable is not set");
      return new Response(JSON.stringify({
        error: "Google Cloud Project not configured"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!GOOGLE_ACCESS_TOKEN) {
      console.error("GOOGLE_ACCESS_TOKEN environment variable is not set");
      return new Response(JSON.stringify({
        error: "Google Access Token not configured"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (e) {
      console.error("Failed to parse JSON body:", e);
      return new Response(JSON.stringify({
        error: "Invalid JSON in request body"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { text } = requestBody;
    if (!text) {
      console.error("Missing text field in request");
      return new Response(JSON.stringify({
        error: "Missing required field: text"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("Converting text to speech:", text.substring(0, 100) + "...");
    // Use Google Cloud Text-to-Speech API
    const requestPayload = {
      input: {
        text: text
      },
      voice: {
        languageCode: "en-IN",
        name: "en-IN-Chirp3-HD-Aoede"
      },
      audioConfig: {
        audioEncoding: "LINEAR16",
        sampleRateHertz: 24000,
        speakingRate: 0.85
      }
    };
    console.log("Request payload:", JSON.stringify(requestPayload, null, 2));
    const gcpResponse = await fetch(GCP_TTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-User-Project": GOOGLE_CLOUD_PROJECT,
        "Authorization": `Bearer ${GOOGLE_ACCESS_TOKEN}`
      },
      body: JSON.stringify(requestPayload)
    });
    console.log("GCP TTS response status:", gcpResponse.status);
    if (!gcpResponse.ok) {
      const errorText = await gcpResponse.text();
      console.error("GCP TTS API error:", errorText);
      return new Response(JSON.stringify({
        error: `GCP TTS API error (${gcpResponse.status}): ${errorText}`,
        status: gcpResponse.status
      }), {
        status: gcpResponse.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const gcpData = await gcpResponse.json();
    console.log("GCP TTS response received");
    // Extract audio content from GCP TTS response
    let base64Audio = "";
    if (gcpData.audioContent) {
      const linear16Data = gcpData.audioContent;
      console.log("Found LINEAR16 audio data");
      // Convert LINEAR16 data to WAV format
      base64Audio = convertLinear16ToWavBase64(linear16Data);
      console.log("Converted LINEAR16 to WAV format");
    } else {
      console.error("No audioContent found in response:", gcpData);
      throw new Error("No audio content found in GCP TTS response");
    }
    console.log("Text-to-speech conversion successful");
    return new Response(JSON.stringify({
      success: true,
      audioContent: base64Audio
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in text-to-speech function:", error);
    return new Response(JSON.stringify({
      error: "Failed to convert text to speech",
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
