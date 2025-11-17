import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { action, candidateId, interviewId, sessionId } = await req.json();
    console.log('Load balancing request:', {
      action,
      candidateId,
      interviewId,
      sessionId
    });
    if (action === 'allocate') {
      return await allocateKey(candidateId, interviewId);
    } else if (action === 'deallocate') {
      return await deallocateKey(sessionId);
    } else if (action === 'heartbeat') {
      return await updateHeartbeat(sessionId);
    } else if (action === 'cleanup') {
      return await cleanupExpiredSessions();
    } else {
      return new Response(JSON.stringify({
        error: 'Invalid action. Use: allocate, deallocate, heartbeat, or cleanup'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    console.error('Error in load-balancing function:', error);
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
async function allocateKey(candidateId, interviewId) {
  try {
    // First cleanup expired sessions
    await cleanupExpiredSessions();
    // Find an available key using round-robin logic
    const { data: keyUsage, error: keyError } = await supabase.from('elevenlabs_key_usage').select('*').eq('is_active', true).lt('current_active_sessions', 5) // Less than max concurrent sessions
    .order('last_used_at', {
      ascending: true
    }).limit(1);
    if (keyError) {
      console.error('Error fetching key usage:', keyError);
      throw keyError;
    }
    if (!keyUsage || keyUsage.length === 0) {
      return new Response(JSON.stringify({
        error: 'No available ElevenLabs API keys',
        message: 'All API keys are at maximum capacity. Please try again later.'
      }), {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const selectedKey = keyUsage[0];
    const keyIndex = selectedKey.key_index;
    // Create a session record
    const sessionExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
    const { data: session, error: sessionError } = await supabase.from('elevenlabs_sessions').insert({
      candidate_id: candidateId,
      interview_id: interviewId,
      api_key_index: keyIndex,
      expires_at: sessionExpiresAt.toISOString()
    }).select().single();
    if (sessionError) {
      console.error('Error creating session:', sessionError);
      throw sessionError;
    }
    // Update key usage counter
    const { error: updateError } = await supabase.from('elevenlabs_key_usage').update({
      current_active_sessions: selectedKey.current_active_sessions + 1,
      last_used_at: new Date().toISOString()
    }).eq('key_index', keyIndex);
    if (updateError) {
      console.error('Error updating key usage:', updateError);
      // Try to cleanup the session we just created
      await supabase.from('elevenlabs_sessions').delete().eq('id', session.id);
      throw updateError;
    }
    console.log(`Allocated key ${keyIndex} to candidate ${candidateId}, session ${session.id}`);
    return new Response(JSON.stringify({
      success: true,
      data: {
        sessionId: session.id,
        keyIndex: keyIndex,
        expiresAt: sessionExpiresAt.toISOString(),
        allocatedAt: session.allocated_at
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in allocateKey:', error);
    return new Response(JSON.stringify({
      error: 'Failed to allocate API key',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
async function deallocateKey(sessionId) {
  try {
    // Get session info
    const { data: session, error: sessionError } = await supabase.from('elevenlabs_sessions').select('*').eq('id', sessionId).eq('session_status', 'active').single();
    if (sessionError || !session) {
      console.log('Session not found or already deallocated:', sessionId);
      return new Response(JSON.stringify({
        success: true,
        message: 'Session already deallocated or not found'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Mark session as completed
    const { error: updateSessionError } = await supabase.from('elevenlabs_sessions').update({
      session_status: 'completed'
    }).eq('id', sessionId);
    if (updateSessionError) {
      console.error('Error updating session status:', updateSessionError);
      throw updateSessionError;
    }
    // Decrease key usage counter
    const { error: updateKeyError } = await supabase.from('elevenlabs_key_usage').update({
      current_active_sessions: Math.max(0, session.current_active_sessions - 1)
    }).eq('key_index', session.api_key_index);
    if (updateKeyError) {
      console.error('Error updating key usage counter:', updateKeyError);
    }
    console.log(`Deallocated key ${session.api_key_index} from session ${sessionId}`);
    return new Response(JSON.stringify({
      success: true,
      message: 'Key deallocated successfully'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in deallocateKey:', error);
    return new Response(JSON.stringify({
      error: 'Failed to deallocate API key',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
async function updateHeartbeat(sessionId) {
  try {
    const { error } = await supabase.from('elevenlabs_sessions').update({
      last_heartbeat: new Date().toISOString()
    }).eq('id', sessionId).eq('session_status', 'active');
    if (error) {
      console.error('Error updating heartbeat:', error);
      throw error;
    }
    return new Response(JSON.stringify({
      success: true,
      message: 'Heartbeat updated'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in updateHeartbeat:', error);
    return new Response(JSON.stringify({
      error: 'Failed to update heartbeat',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
async function cleanupExpiredSessions() {
  try {
    // Call the database function to cleanup expired sessions
    const { data, error } = await supabase.rpc('cleanup_expired_elevenlabs_sessions');
    if (error) {
      console.error('Error cleaning up expired sessions:', error);
      throw error;
    }
    console.log(`Cleaned up ${data} expired sessions`);
    return new Response(JSON.stringify({
      success: true,
      message: `Cleaned up ${data} expired sessions`
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in cleanupExpiredSessions:', error);
    return new Response(JSON.stringify({
      error: 'Failed to cleanup expired sessions',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
