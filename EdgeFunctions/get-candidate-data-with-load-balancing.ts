import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";
import { fromZonedTime } from "https://esm.sh/date-fns-tz@3.0.0";
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
    const { username } = await req.json();
    if (!username) {
      return new Response(JSON.stringify({
        error: 'Missing required field: username'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Fetching candidate data with load balancing for username:', username);
    // **CLEANUP: Free any stale sessions before allocating new ones**
    console.log('Cleaning up stale ElevenLabs sessions...');
    try {
      const cleanupResponse = await supabase.functions.invoke('elevenlabs-session-cleanup', {
        body: {}
      });
      if (cleanupResponse.data?.success) {
        console.log(`Cleaned up ${cleanupResponse.data.expiredSessions} stale sessions`);
      } else {
        console.warn('Session cleanup failed:', cleanupResponse.error);
      }
    } catch (cleanupError) {
      console.warn('Session cleanup error (non-blocking):', cleanupError);
    }
    // Fetch candidate data
    const { data: candidateData, error: candidateError } = await supabase.from('candidate').select('*').eq('username', username).maybeSingle();
    if (candidateError) {
      console.error('Error fetching candidate:', candidateError);
      return new Response(JSON.stringify({
        error: 'Database error while fetching candidate data',
        details: candidateError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!candidateData) {
      return new Response(JSON.stringify({
        error: 'Candidate not found',
        message: 'No candidate found with the provided username.'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check if the interview has already been attempted
    const { data: existingTranscript, error: transcriptError } = await supabase.from('transcripts').select('*').eq('candidate_id', candidateData.id).eq('interview_id', candidateData.interview_id).maybeSingle();
    if (transcriptError) {
      console.error('Error checking existing transcript:', transcriptError);
      return new Response(JSON.stringify({
        error: 'Database error while checking interview status',
        details: transcriptError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (existingTranscript) {
      return new Response(JSON.stringify({
        error: 'Interview Already Attempted',
        message: 'You have already completed this interview. You cannot retake it.'
      }), {
        status: 409,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Fetch interview details with organization name
    const { data: interviewData, error: interviewError } = await supabase.from('interview').select(`
        *,
        organizations (
          name
        )
      `).eq('id', candidateData.interview_id).single();
    if (interviewError) {
      console.error('Error fetching interview:', interviewError);
      return new Response(JSON.stringify({
        error: 'Interview not found',
        details: interviewError.message
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check interview timing using both UTC and IST interpretations to avoid false negatives
    const nowUtc = new Date();
    if (interviewData.start_date && interviewData.start_time) {
      const startUtc_assumingUTC = new Date(`${interviewData.start_date}T${interviewData.start_time}Z`);
      const startUtc_assumingIST = fromZonedTime(`${interviewData.start_date}T${interviewData.start_time}`, 'Asia/Kolkata');
      console.log('Timing check (start):', {
        nowUtc: nowUtc.toISOString(),
        startUtc_assumingUTC: startUtc_assumingUTC.toISOString(),
        startUtc_assumingIST: startUtc_assumingIST.toISOString(),
        start_date: interviewData.start_date,
        start_time: interviewData.start_time
      });
      // Only block if now is before BOTH interpretations
      if (nowUtc < startUtc_assumingUTC && nowUtc < startUtc_assumingIST) {
        return new Response(JSON.stringify({
          error: 'Interview Not Yet Started',
          message: 'The interview has not yet started. Please come back at the scheduled time.'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    if (interviewData.end_date && interviewData.end_time) {
      const endUtc_assumingUTC = new Date(`${interviewData.end_date}T${interviewData.end_time}Z`);
      const endUtc_assumingIST = fromZonedTime(`${interviewData.end_date}T${interviewData.end_time}`, 'Asia/Kolkata');
      console.log('Timing check (end):', {
        nowUtc: nowUtc.toISOString(),
        endUtc_assumingUTC: endUtc_assumingUTC.toISOString(),
        endUtc_assumingIST: endUtc_assumingIST.toISOString(),
        end_date: interviewData.end_date,
        end_time: interviewData.end_time
      });
      // Only block if now is after BOTH interpretations
      if (nowUtc > endUtc_assumingUTC && nowUtc > endUtc_assumingIST) {
        return new Response(JSON.stringify({
          error: 'Interview Window Closed',
          message: 'The window to attempt this interview has ended.'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Fetch interview constraints
    const { data: constraintsData, error: constraintsError } = await supabase.from('interview_constraints').select('*').eq('interview_id', candidateData.interview_id);
    if (constraintsError) {
      console.error('Error fetching constraints:', constraintsError);
    }
    // **NEW: Allocate ElevenLabs API key using load balancing**
    console.log('Allocating ElevenLabs API key for candidate:', candidateData.id);
    const loadBalancingResponse = await supabase.functions.invoke('load-balancing', {
      body: {
        action: 'allocate',
        candidateId: candidateData.id,
        interviewId: candidateData.interview_id
      }
    });
    if (loadBalancingResponse.error) {
      console.error('Error allocating API key:', loadBalancingResponse.error);
      return new Response(JSON.stringify({
        error: 'Failed to allocate API key',
        message: 'Unable to allocate ElevenLabs API key. Please try again later.',
        details: loadBalancingResponse.error.message
      }), {
        status: 503,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const loadBalancingData = loadBalancingResponse.data;
    console.log('Successfully fetched candidate data with load balancing:', {
      candidate: candidateData.name,
      keyIndex: loadBalancingData?.data?.keyIndex,
      sessionId: loadBalancingData?.data?.sessionId
    });
    // Return enhanced response with load balancing info
    return new Response(JSON.stringify({
      success: true,
      data: {
        candidateId: candidateData.id,
        candidateName: candidateData.name,
        candidateEmail: candidateData.email,
        candidatePhone: candidateData.phone,
        resumeSummary: candidateData.resume_summary,
        position: interviewData.position,
        duration: interviewData.duration,
        jobDescription: interviewData.job_description,
        organizationName: interviewData.organizations?.name || 'Unknown Organization',
        language: interviewData.language || 'english',
        constraints: constraintsData || [],
        interviewId: candidateData.interview_id,
        // NEW: Load balancing information
        loadBalancing: {
          keyIndex: loadBalancingData?.data?.keyIndex,
          sessionId: loadBalancingData?.data?.sessionId,
          expiresAt: loadBalancingData?.data?.expiresAt,
          allocatedAt: loadBalancingData?.data?.allocatedAt
        }
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Unexpected error in get-candidate-data-with-load-balancing:', error);
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
