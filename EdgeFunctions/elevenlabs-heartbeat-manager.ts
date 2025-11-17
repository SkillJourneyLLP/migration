import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { sessionId } = await req.json();
    console.log(`Heartbeat request for session: ${sessionId}`);
    if (!sessionId) {
      return new Response(JSON.stringify({
        error: 'Session ID is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Update heartbeat timestamp and extend expiration by 3 minutes
    const { data: session, error: updateError } = await supabase.from('elevenlabs_sessions').update({
      last_heartbeat: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', sessionId).eq('session_status', 'active').select().single();
    if (updateError) {
      console.error('Error updating heartbeat:', updateError);
      return new Response(JSON.stringify({
        error: 'Failed to update heartbeat',
        details: updateError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!session) {
      console.log(`Session ${sessionId} not found or not active`);
      return new Response(JSON.stringify({
        error: 'Session not found or not active'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Calculate remaining time until expiration
    const expiresAt = new Date(session.expires_at);
    const now = new Date();
    const remainingMinutes = Math.max(0, (expiresAt.getTime() - now.getTime()) / (1000 * 60));
    console.log(`Heartbeat updated for session ${sessionId}, expires in ${remainingMinutes.toFixed(1)} minutes`);
    return new Response(JSON.stringify({
      success: true,
      sessionId: session.id,
      expiresAt: session.expires_at,
      remainingMinutes: Math.floor(remainingMinutes),
      apiKeyIndex: session.api_key_index
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in heartbeat manager:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
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
