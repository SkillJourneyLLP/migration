import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const handler = async (req)=>{
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
    const { candidateId, interviewId } = await req.json();
    console.log('Processing re-evaluate for candidate:', candidateId, 'in interview:', interviewId);
    // Update results table - clear score, recommendation, report_link, set report_generated to false, status to pending
    const { error: resultsError } = await supabase.from('results').update({
      score: null,
      recommendation: null,
      report_link: null,
      report_generated: false,
      status: 'pending'
    }).eq('candidate_id', candidateId).eq('interview_id', interviewId);
    if (resultsError) {
      console.error('Error updating results:', resultsError);
      throw resultsError;
    }
    // Delete from interview_qa table
    const { error: qaError } = await supabase.from('interview_qa').delete().eq('candidate_id', candidateId).eq('interview_id', interviewId);
    if (qaError) {
      console.error('Error deleting interview_qa:', qaError);
      throw qaError;
    }
    // Delete from report_eval_criteria table
    const { error: evalError } = await supabase.from('report_eval_criteria').delete().eq('candidate_id', candidateId).eq('interview_id', interviewId);
    if (evalError) {
      console.error('Error deleting report_eval_criteria:', evalError);
      throw evalError;
    }
    console.log('Re-evaluate processing completed successfully');
    return new Response(JSON.stringify({
      success: true,
      message: `Re-evaluate completed for candidate`
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in re-evaluate-candidate function:', error);
    return new Response(JSON.stringify({
      error: 'Failed to re-evaluate candidate',
      details: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
};
Deno.serve(handler);
