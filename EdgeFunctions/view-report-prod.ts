import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.53.0';
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
    let candidateId;
    let interviewId;
    if (req.method === 'GET') {
      // Handle GET request with query parameters
      const url = new URL(req.url);
      candidateId = url.searchParams.get('candidateId') || '';
      interviewId = url.searchParams.get('interviewId') || '';
    } else {
      // Handle POST request with body
      const body = await req.json();
      candidateId = body.candidateId;
      interviewId = body.interviewId;
    }
    if (!candidateId || !interviewId) {
      return new Response('Missing candidateId or interviewId', {
        status: 400
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Fetch all required data
    const [candidateResult, interviewResult, resultResult, evalCriteriaResult, qaResult] = await Promise.all([
      supabase.from('candidate').select('*').eq('id', candidateId).single(),
      supabase.from('interview').select('position').eq('id', interviewId).single(),
      supabase.from('results').select('*').eq('candidate_id', candidateId).eq('interview_id', interviewId).single(),
      supabase.from('report_eval_criteria').select('*').eq('candidate_id', candidateId).eq('interview_id', interviewId),
      supabase.from('interview_qa').select('*').eq('candidate_id', candidateId).eq('interview_id', interviewId)
    ]);
    const candidate = candidateResult.data;
    const interview = interviewResult.data;
    const result = resultResult.data;
    const evalCriteria = evalCriteriaResult.data || [];
    const qaData = qaResult.data || [];
    if (!candidate || !interview || !result) {
      return new Response('Data not found', {
        status: 404
      });
    }
    const getScoreColor = (score)=>{
      const numScore = parseInt(score);
      if (numScore >= 80) return '#10B981'; // green
      if (numScore >= 70) return '#3B82F6'; // blue
      if (numScore >= 60) return '#F59E0B'; // yellow
      if (numScore >= 50) return '#F97316'; // orange
      return '#EF4444'; // red
    };
    const getRecommendationColor = (recommendation)=>{
      if (recommendation === 'Superstar') return '#10B981';
      if (recommendation === 'Excellent Fit') return '#3B82F6';
      if (recommendation === 'Good Fit') return '#F59E0B';
      if (recommendation === 'Fit') return '#F97316';
      if (recommendation === 'Somewhat Fit') return '#EF4444';
      return '#6B7280';
    };
    // Return JSON data instead of HTML
    const reportData = {
      candidate,
      interview,
      result,
      evalCriteria,
      qaData
    };
    return new Response(JSON.stringify(reportData), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in view-report function:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
