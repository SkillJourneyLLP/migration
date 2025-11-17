import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const ELEVENLABS_STT_MODEL = 'scribe_v1';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const sleep = (ms)=>new Promise((resolve)=>setTimeout(resolve, ms));
async function callElevenLabsWithRetry(formData, retries = MAX_RETRIES) {
  for(let attempt = 1; attempt <= retries; attempt++){
    try {
      console.log(`Attempt ${attempt}/${retries} - Calling ElevenLabs API`);
      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
          'xi-api-key': Deno.env.get('ELEVENLABS_API_KEY')
        },
        body: formData
      });
      // If successful or non-retryable error, return immediately
      if (response.ok || response.status !== 429 && response.status < 500) {
        return response;
      }
      // Log the error for retry-eligible cases
      const errorText = await response.text();
      console.error(`ElevenLabs API error (attempt ${attempt}):`, response.status, errorText);
      // If this is the last attempt, return the response
      if (attempt === retries) {
        return new Response(errorText, {
          status: response.status,
          headers: response.headers
        });
      }
      // Wait before retrying (exponential backoff)
      await sleep(RETRY_DELAY * attempt);
    } catch (error) {
      console.error(`Network error on attempt ${attempt}:`, error);
      if (attempt === retries) {
        throw error;
      }
      await sleep(RETRY_DELAY * attempt);
    }
  }
  throw new Error('Maximum retry attempts exceeded');
}
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    const audioFileData = body.file;
    if (!audioFileData) {
      console.error('Missing audio file in request');
      return new Response(JSON.stringify({
        error: 'Missing required field: audio file is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Validate file is not empty
    if (!audioFileData.size || audioFileData.size === 0) {
      console.error('Empty audio file received');
      return new Response(JSON.stringify({
        error: 'Audio file is empty or corrupted'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Validate minimum file size (1KB)
    if (audioFileData.size < 1000) {
      console.error('Audio file too small:', audioFileData.size);
      return new Response(JSON.stringify({
        error: 'Audio file is too small - please record for at least 1 second'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Converting speech to text, file size:', audioFileData.size);
    // Convert base64 back to blob
    const binaryString = atob(audioFileData.data);
    const bytes = new Uint8Array(binaryString.length);
    for(let i = 0; i < binaryString.length; i++){
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([
      bytes
    ], {
      type: audioFileData.type || 'audio/webm'
    });
    // Prepare form data for ElevenLabs
    const elevenLabsFormData = new FormData();
    elevenLabsFormData.append('file', audioBlob, 'recording.webm');
    elevenLabsFormData.append('model_id', ELEVENLABS_STT_MODEL);
    // Call ElevenLabs with retry logic
    const response = await callElevenLabsWithRetry(elevenLabsFormData);
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to convert speech to text';
      // Provide more specific error messages
      if (response.status === 429) {
        errorMessage = 'Speech service is busy - please try again in a moment';
      } else if (response.status === 400) {
        const errorData = JSON.parse(errorText || '{}');
        if (errorData.detail?.status === 'audio_too_short') {
          errorMessage = 'Please speak for at least 1 second';
        } else if (errorData.detail?.status === 'empty_file') {
          errorMessage = 'Audio recording failed - please try again';
        }
      }
      console.error('ElevenLabs STT final error:', response.status, errorText);
      return new Response(JSON.stringify({
        error: errorMessage,
        details: errorText
      }), {
        status: response.status >= 500 ? 503 : 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const data = await response.json();
    const transcript = data.text?.trim() || '';
    console.log('Speech-to-text conversion successful:', transcript);
    // Filter out background noise indicators
    const filteredTranscript = transcript.replace(/\(background noise\)|Background noise|\(트수\)|\(背景噪音\)/gi, '').trim();
    return new Response(JSON.stringify({
      success: true,
      text: filteredTranscript
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in speech-to-text function:', error);
    return new Response(JSON.stringify({
      error: 'Failed to convert speech to text - please try again',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
