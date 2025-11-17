import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verify } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const jwtSecret = Deno.env.get('JWT_SECRET') || 'default-secret-key-change-in-production';
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(jwtSecret), {
  name: "HMAC",
  hash: "SHA-256"
}, false, [
  "sign",
  "verify"
]);
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Authorization required'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const payload = await verify(token, key);
    const userId = payload.userId;
    const { interviewId } = await req.json();
    // Verify interview belongs to user
    const { data: interview, error: interviewError } = await supabase.from('interview').select('id').eq('id', interviewId).eq('user_id', userId).single();
    if (interviewError || !interview) {
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
    // Get candidates count (registered)
    const { count: registeredCount } = await supabase.from('candidate').select('*', {
      count: 'exact',
      head: true
    }).eq('interview_id', interviewId);
    // Get attempted count (candidates who have transcripts)
    const { data: transcripts, error: transcriptsError } = await supabase.from('transcripts').select('candidate_id').eq('interview_id', interviewId);
    if (transcriptsError) {
      console.error('Error fetching transcripts:', transcriptsError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch transcripts'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Get results for reports generated count
    const { data: results, error: resultsError } = await supabase.from('results').select('report_link').eq('interview_id', interviewId).not('report_link', 'is', null);
    if (resultsError) {
      console.error('Error fetching results:', resultsError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch results'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const attemptedCount = transcripts.length; // Only count candidates with transcripts
    const reportsGeneratedCount = results.length; // Count results with report_link
    const leftCount = Math.max(0, (registeredCount || 0) - attemptedCount);
    const metrics = {
      registered: registeredCount || 0,
      attempted: attemptedCount,
      left: leftCount,
      reportsGenerated: reportsGeneratedCount
    };
    return new Response(JSON.stringify({
      metrics
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in interview-metrics function:', error);
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
