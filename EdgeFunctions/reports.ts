import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";
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
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { action, resultId } = await req.json();
    switch(action){
      case 'fetchReportData':
        return await handleFetchReportData(supabaseClient, resultId);
      default:
        return new Response(JSON.stringify({
          error: 'Invalid action'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
    }
  } catch (error) {
    console.error('Error:', error);
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
async function handleFetchReportData(supabaseClient, resultId) {
  try {
    // Fetch result data
    const { data: resultData, error: resultError } = await supabaseClient.from('results').select('id, name, email, score, recommendation, report_link, candidate_id, interview_id').eq('id', resultId).single();
    if (resultError) throw resultError;
    // Fetch candidate data
    const { data: candidateData, error: candidateError } = await supabaseClient.from('candidate').select('phone').eq('id', resultData.candidate_id).single();
    // Fetch interview data
    const { data: interviewData, error: interviewError } = await supabaseClient.from('interview').select('position').eq('id', resultData.interview_id).single();
    if (candidateError || interviewError) {
      throw new Error('Failed to fetch related data');
    }
    const completeResult = {
      ...resultData,
      candidate: candidateData,
      interview: interviewData
    };
    // Extract Q&A pairs from report_link JSON
    let qaPairs = [];
    try {
      const reportData = JSON.parse(completeResult.report_link || '{}');
      qaPairs = reportData.qa_pairs || [];
    } catch (e) {
      console.error('Failed to parse report_link:', e);
    }
    return new Response(JSON.stringify({
      result: completeResult,
      qaPairs: qaPairs
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching report data:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch report data'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
