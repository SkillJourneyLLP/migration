import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const LIVEKIT_URL = Deno.env.get('LIVEKIT_URL');
    const API_KEY = Deno.env.get('LIVEKIT_API_KEY');
    const API_SECRET = Deno.env.get('LIVEKIT_API_SECRET');
    if (!LIVEKIT_URL) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    if (!API_KEY) {
      throw new Error('LIVEKIT_API_KEY is not defined');
    }
    if (!API_SECRET) {
      throw new Error('LIVEKIT_API_SECRET is not defined');
    }
    // Parse request body
    const body = await req.json();
    const agentName = body?.room_config?.agents?.[0]?.agent_name;
    const participantName = body?.participantName || 'user';
    // Generate unique identifiers
    const participantIdentity = `voice_assistant_user_${Math.floor(Math.random() * 10_000)}`;
    const roomName = `voice_assistant_room_${Math.floor(Math.random() * 10_000)}`;
    // Create participant token
    const participantToken = await createParticipantToken({
      identity: participantIdentity,
      name: participantName
    }, roomName, agentName, API_KEY, API_SECRET);
    // Return connection details
    const data = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantToken: participantToken,
      participantName
    };
    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in generate-livekit-token function:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
async function createParticipantToken(userInfo, roomName, agentName, apiKey, apiSecret) {
  // Create JWT header
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  // Create JWT payload
  const now = Math.floor(Date.now() / 1000);
  const ttl = 15 * 60; // 15 minutes
  const payload = {
    exp: now + ttl,
    iss: apiKey,
    nbf: now,
    sub: userInfo.identity,
    name: userInfo.name,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true
    }
  };
  // Add room configuration if agent name is provided
  if (agentName) {
    payload.roomConfig = {
      agents: [
        {
          agentName
        }
      ]
    };
  }
  // Encode JWT
  const encoder = new TextEncoder();
  const headerBase64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadBase64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const message = `${headerBase64}.${payloadBase64}`;
  // Create signature
  const key = await crypto.subtle.importKey('raw', encoder.encode(apiSecret), {
    name: 'HMAC',
    hash: 'SHA-256'
  }, false, [
    'sign'
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${message}.${signatureBase64}`;
}
