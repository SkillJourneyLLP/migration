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
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({
        valid: false,
        error: 'Token is required'
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
    console.log('JWT_SECRET:', jwtSecret);
    if (!jwtSecret) {
      console.error('JWT_SECRET not configured');
      return new Response(JSON.stringify({
        valid: false,
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    try {
      // Create key for verification
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(jwtSecret), {
        name: "HMAC",
        hash: "SHA-256"
      }, false, [
        "sign",
        "verify"
      ]);
      let payload;
      try {
        // Try to verify normally first
        payload = await jwt.verify(token, key);
      } catch (verifyError) {
        // If verification fails due to expiration, verify without expiration check
        const [header, payloadPart, signature] = token.split('.');
        if (!header || !payloadPart || !signature) {
          throw new Error('Invalid token format');
        }
        // Decode payload to check if it's a valid structure
        const decodedPayload = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')));
        // Verify signature manually (ignoring expiration)
        const dataToVerify = `${header}.${payloadPart}`;
        const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataToVerify))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        if (signature !== expectedSignature) {
          throw new Error('Invalid signature');
        }
        payload = decodedPayload;
      }
      console.log(`Token verified successfully for username: ${payload.username}`);
      return new Response(JSON.stringify({
        valid: true,
        username: payload.username,
        expiresAt: null // Never expires
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError);
      return new Response(JSON.stringify({
        valid: false,
        error: 'Invalid or expired token'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    console.error('Error verifying token:', error);
    return new Response(JSON.stringify({
      valid: false,
      error: 'Failed to verify token'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
