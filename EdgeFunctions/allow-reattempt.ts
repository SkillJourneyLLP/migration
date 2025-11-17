// @ts-nocheck
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
    const { candidateIds, interviewId } = await req.json();
    console.log('Processing reattempt for candidates:', candidateIds, 'in interview:', interviewId);
    // Update results table - clear score, recommendation, report_link, set report_generated to false, status to pending
    const { error: resultsError } = await supabase.from('results').update({
      score: null,
      recommendation: null,
      report_link: null,
      report_generated: false,
      status: 'pending'
    }).in('candidate_id', candidateIds);
    if (resultsError) {
      console.error('Error updating results:', resultsError);
      throw resultsError;
    }
    // Delete from transcripts table
    const { error: transcriptsError } = await supabase.from('transcripts').delete().in('candidate_id', candidateIds);
    if (transcriptsError) {
      console.error('Error deleting transcripts:', transcriptsError);
      throw transcriptsError;
    }
    // Delete from interview_qa table
    const { error: qaError } = await supabase.from('interview_qa').delete().in('candidate_id', candidateIds);
    if (qaError) {
      console.error('Error deleting interview_qa:', qaError);
      throw qaError;
    }
    // Delete from report_eval_criteria table
    const { error: evalError } = await supabase.from('report_eval_criteria').delete().in('candidate_id', candidateIds);
    if (evalError) {
      console.error('Error deleting report_eval_criteria:', evalError);
      throw evalError;
    }
    // Delete video files from storage
    for (const candidateId of candidateIds){
      const videoFileName = `${interviewId}_${candidateId}.webm`;
      const { error: storageError } = await supabase.storage.from('video-recordings').remove([
        videoFileName
      ]);
      if (storageError) {
        console.error(`Error deleting video file ${videoFileName}:`, storageError);
      // Don't throw here - continue with other deletions even if video file doesn't exist
      } else {
        console.log(`Successfully deleted video file: ${videoFileName}`);
      }
    }
    console.log('Reattempt processing completed successfully');
    return new Response(JSON.stringify({
      success: true,
      message: `Reattempt enabled for ${candidateIds.length} candidates`
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in allow-reattempt function:', error);
    return new Response(JSON.stringify({
      error: 'Failed to enable reattempt',
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
