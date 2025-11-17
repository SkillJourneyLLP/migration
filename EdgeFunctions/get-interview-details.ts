import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { interviewId } = await req.json();
    if (!interviewId) {
      console.error('Missing interviewId in request');
      return new Response(JSON.stringify({
        error: 'Interview ID is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Fetching interview details for ID: ${interviewId}`);
    // Fetch interview details from database
    const { data: interview, error: interviewError } = await supabase.from('interview').select('id, position, duration, job_description, start_date, start_time, end_date, end_time, deactive').eq('id', interviewId).single();
    if (interviewError) {
      console.error('Error fetching interview:', interviewError);
      return new Response(JSON.stringify({
        error: 'Interview not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!interview) {
      console.error('Interview not found for ID:', interviewId);
      return new Response(JSON.stringify({
        error: 'Interview not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check if interview is deactivated
    if (interview.deactive === true) {
      console.log('Interview is deactivated:', interviewId);
      return new Response(JSON.stringify({
        error: 'Applications for this interview are closed'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check if interview is within valid time window
    const now = new Date();
    // Convert UTC time to IST for comparison
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(now.getTime() + istOffset);
    const startDateTime = new Date(`${interview.start_date}T${interview.start_time}`);
    const endDateTime = new Date(`${interview.end_date}T${interview.end_time}`);
    if (nowIST < startDateTime) {
      console.log('Interview has not started yet:', interviewId);
      return new Response(JSON.stringify({
        error: 'Interview applications have not started yet'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (nowIST > endDateTime) {
      console.log('Interview has ended:', interviewId);
      return new Response(JSON.stringify({
        error: 'Applications for this interview are closed'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Successfully fetched interview details:', interviewId);
    return new Response(JSON.stringify({
      success: true,
      interview: {
        id: interview.id,
        position: interview.position,
        duration: interview.duration,
        jobDescription: interview.job_description,
        startDate: interview.start_date,
        startTime: interview.start_time,
        endDate: interview.end_date,
        endTime: interview.end_time
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in get-interview-details function:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
