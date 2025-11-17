import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const ELEVENLABS_VOICE_ID = "XrExE9yKIg1WjnnlVkGX";
const ELEVENLABS_TTS_MODEL = "eleven_multilingual_v2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// safer base64 conversion for large audio
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks
  for(let i = 0; i < bytes.length; i += chunkSize){
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { text, apikeyIndex } = await req.json();
    if (!text) {
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
    if (apikeyIndex === undefined || apikeyIndex === null) {
      return new Response(JSON.stringify({
        error: "Missing required field: apikeyIndex"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("Converting text to speech:", text.substring(0, 100) + "...");
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: "POST",
      headers: {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": Deno.env.get(`ELEVENLABS_API_KEY_${apikeyIndex}`)
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_TTS_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        }
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs TTS API error:", errorText);
      return new Response(JSON.stringify({
        error: errorText
      }), {
        status: response.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const audioBuffer = await response.arrayBuffer();
    const base64Audio = arrayBufferToBase64(audioBuffer);
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
    console.error("Error in text-to-speech-dynamic function:", error);
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
