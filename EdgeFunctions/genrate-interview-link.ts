import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as jwt from "https://deno.land/x/djwt@v2.9.1/mod.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { username } = await req.json();
    if (!username) {
      return new Response(JSON.stringify({
        error: 'Username is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Get JWT secret from environment
    const jwtSecret = Deno.env.get('JWT_SECRET');
    if (!jwtSecret) {
      console.error('JWT_SECRET not configured');
      return new Response(JSON.stringify({
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Create JWT payload (no expiration)
    const payload = {
      username: username,
      iat: Math.floor(Date.now() / 1000)
    };
    // Sign the JWT
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(jwtSecret), {
      name: "HMAC",
      hash: "SHA-256"
    }, false, [
      "sign",
      "verify"
    ]);
    const token = await jwt.create({
      alg: "HS256",
      typ: "JWT"
    }, payload, key);
    // Create the interview link
    const interviewLink = `interview.skilljourney.in/external-auth?access_token=${token}`;
    console.log(`Generated interview link for username: ${username}`);
    return new Response(JSON.stringify({
      success: true,
      link: interviewLink,
      expiresAt: null // Never expires
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error generating interview link:', error);
    return new Response(JSON.stringify({
      error: 'Failed to generate interview link'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
