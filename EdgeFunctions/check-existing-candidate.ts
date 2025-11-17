import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import * as jwt from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const handler = async (req)=>{
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { email, access_token } = await req.json();
    if (!email || !access_token) {
      return new Response(JSON.stringify({
        error: "Email and access_token are required"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    // Verify JWT token and extract interview_id
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
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(jwtSecret), {
      name: "HMAC",
      hash: "SHA-256"
    }, false, [
      "sign",
      "verify"
    ]);
    let payload;
    try {
      payload = await jwt.verify(access_token, key);
    } catch (error) {
      console.error('Invalid access token:', error);
      return new Response(JSON.stringify({
        error: 'Invalid access token'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const interviewId = payload.interview_id;
    if (!interviewId) {
      return new Response(JSON.stringify({
        error: 'Invalid token: missing interview ID'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check if candidate already exists for this interview
    const { data: existingCandidate, error } = await supabase.from('candidate').select('id, link').eq('email', email).eq('interview_id', interviewId).maybeSingle();
    if (error) {
      console.error('Error checking candidate:', error);
      return new Response(JSON.stringify({
        error: "Database error occurred"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    if (existingCandidate) {
      return new Response(JSON.stringify({
        exists: true,
        link: existingCandidate.link,
        message: "You have already applied for this interview."
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    return new Response(JSON.stringify({
      exists: false,
      message: "No existing application found."
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error("Error in check-existing-candidate function:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  }
};
serve(handler);
