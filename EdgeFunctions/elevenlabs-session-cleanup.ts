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
    console.log('Starting session cleanup based on heartbeat timeout');
    const now = new Date();
    const threeMinutesAgo = new Date(now.getTime() - 3 * 60 * 1000);
    // Find sessions where last_heartbeat is older than 3 minutes and still active
    const { data: expiredSessions, error: fetchError } = await supabase.from('elevenlabs_sessions').select('*').eq('session_status', 'active').lt('last_heartbeat', threeMinutesAgo.toISOString());
    if (fetchError) {
      console.error('Error fetching expired sessions:', fetchError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch expired sessions'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!expiredSessions || expiredSessions.length === 0) {
      console.log('No expired sessions found');
      return new Response(JSON.stringify({
        success: true,
        expiredSessions: 0,
        message: 'No expired sessions found'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Found ${expiredSessions.length} expired sessions to cleanup`);
    const cleanupResults = [];
    for (const session of expiredSessions){
      try {
        // Mark session as expired
        const { error: updateSessionError } = await supabase.from('elevenlabs_sessions').update({
          session_status: 'expired',
          updated_at: now.toISOString()
        }).eq('id', session.id);
        if (updateSessionError) {
          console.error(`Error updating session ${session.id}:`, updateSessionError);
          continue;
        }
        // Decrement the active session count for this key
        const { error: updateKeyError } = await supabase.from('elevenlabs_key_usage').update({
          current_active_sessions: Math.max(0, await supabase.from('elevenlabs_key_usage').select('current_active_sessions').eq('key_index', session.api_key_index).single().then(({ data })=>(data?.current_active_sessions || 1) - 1)),
          updated_at: now.toISOString()
        }).eq('key_index', session.api_key_index);
        if (updateKeyError) {
          console.error(`Error updating key usage for key ${session.api_key_index}:`, updateKeyError);
        }
        // Get current session count for this key after decrement
        const { data: keyData } = await supabase.from('elevenlabs_key_usage').select('current_active_sessions').eq('key_index', session.api_key_index).single();
        cleanupResults.push({
          sessionId: session.id,
          candidateId: session.candidate_id,
          interviewId: session.interview_id,
          apiKeyIndex: session.api_key_index,
          lastHeartbeat: session.last_heartbeat,
          minutesSinceHeartbeat: Math.floor((now.getTime() - new Date(session.last_heartbeat).getTime()) / (1000 * 60)),
          keyActiveSessionsAfterCleanup: keyData?.current_active_sessions || 0
        });
        console.log(`Cleaned up session ${session.id} for candidate ${session.candidate_id}, key ${session.api_key_index}`);
      } catch (error) {
        console.error(`Error cleaning up session ${session.id}:`, error);
      }
    }
    console.log(`Session cleanup completed. Processed ${cleanupResults.length} sessions`);
    return new Response(JSON.stringify({
      success: true,
      expiredSessions: cleanupResults.length,
      cleanupResults: cleanupResults,
      timestamp: now.toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in session cleanup:', error);
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
