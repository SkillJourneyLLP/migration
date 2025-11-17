import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const GEMINI_MODEL = "models/gemini-2.5-pro";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/${GEMINI_MODEL}:generateContent`;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const sleep = (ms)=>new Promise((resolve)=>setTimeout(resolve, ms));
async function callGeminiWithRetry(requestBody, retries = MAX_RETRIES) {
  for(let attempt = 1; attempt <= retries; attempt++){
    try {
      console.log(`Attempt ${attempt}/${retries} – Calling Gemini API`);
      const response = await fetch(GEMINI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": Deno.env.get("GEMINI_API_KEY")
        },
        body: JSON.stringify(requestBody)
      });
      if (response.ok || response.status < 500 && response.status !== 429) {
        return response;
      }
      const errorText = await response.text();
      console.error(`Gemini API error (attempt ${attempt}):`, response.status, errorText);
      if (attempt === retries) {
        return new Response(errorText, {
          status: response.status,
          headers: response.headers
        });
      }
      await sleep(RETRY_DELAY * attempt);
    } catch (error) {
      console.error(`Network error on attempt ${attempt}:`, error);
      if (attempt === retries) throw error;
      await sleep(RETRY_DELAY * attempt);
    }
  }
  throw new Error("Maximum retry attempts exceeded");
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    const audioFileData = body.file;
    if (!audioFileData) {
      console.error("Missing audio file in request");
      return new Response(JSON.stringify({
        error: "Missing required field: audio file is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!audioFileData.size || audioFileData.size === 0) {
      console.error("Empty audio file received");
      return new Response(JSON.stringify({
        error: "Audio file is empty or corrupted"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (audioFileData.size < 1000) {
      console.error("Audio file too small:", audioFileData.size);
      return new Response(JSON.stringify({
        error: "Audio file is too small – please record for at least 1 second"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("Converting speech to text with Gemini, file size:", audioFileData.size);
    // Convert base64 back to Uint8Array
    const binaryString = atob(audioFileData.data);
    const bytes = new Uint8Array(binaryString.length);
    for(let i = 0; i < binaryString.length; i++){
      bytes[i] = binaryString.charCodeAt(i);
    }
    // Convert to base64 string for Gemini inline_data
    const base64Audio = btoa(String.fromCharCode(...bytes));
    // Prepare Gemini request
    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: audioFileData.type || "audio/webm",
                data: base64Audio
              }
            }
          ]
        }
      ]
    };
    // Call Gemini with retry logic
    const response = await callGeminiWithRetry(requestBody);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini STT final error:", response.status, errorText);
      return new Response(JSON.stringify({
        error: "Failed to convert speech to text",
        details: errorText
      }), {
        status: response.status >= 500 ? 503 : 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const data = await response.json();
    const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    console.log("Speech-to-text conversion successful:", transcript);
    const filteredTranscript = transcript.replace(/\(background noise\)|Background noise|\(트수\)|\(背景噪音\)/gi, "").trim();
    return new Response(JSON.stringify({
      success: true,
      text: filteredTranscript
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in speech-to-text function:", error);
    return new Response(JSON.stringify({
      error: "Failed to convert speech to text – please try again",
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
