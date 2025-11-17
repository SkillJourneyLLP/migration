import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    const { candidateId, interviewId, proctoringResult } = await req.json();
    console.log('Storing video proctoring result for candidate:', candidateId, 'interview:', interviewId);
    if (!candidateId || !interviewId || !proctoringResult) {
      throw new Error('Missing required parameters: candidateId, interviewId, and proctoringResult');
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    // Store the result in the results table
    const { error: updateError } = await supabase.from('results').update({
      proctoring: JSON.stringify(proctoringResult),
      updated_at: new Date().toISOString()
    }).eq('candidate_id', candidateId).eq('interview_id', interviewId);
    if (updateError) {
      console.error('Error updating results:', updateError);
      throw new Error('Failed to store proctoring results');
    }
    console.log('Proctoring results stored successfully');
    return new Response(JSON.stringify({
      success: true,
      message: 'Proctoring results stored successfully',
      result: proctoringResult
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in video-proctoring function:', error);
    return new Response(JSON.stringify({
      success: false,
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
