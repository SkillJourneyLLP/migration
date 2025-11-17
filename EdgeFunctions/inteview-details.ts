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
    const { action, interviewId } = await req.json();
    switch(action){
      case 'fetchInterviewDetails':
        return await handleFetchInterviewDetails(supabaseClient, interviewId);
      case 'fetchInterviewConstraints':
        return await handleFetchInterviewConstraints(supabaseClient, interviewId);
      case 'fetchEditData':
        return await handleFetchEditData(supabaseClient, interviewId);
      case 'fetchEditConstraints':
        return await handleFetchEditConstraints(supabaseClient, interviewId);
      case 'fetchEditCandidates':
        return await handleFetchEditCandidates(supabaseClient, interviewId);
      case 'fetchEvaluationCriteria':
        return await handleFetchEvaluationCriteria(supabaseClient, interviewId);
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
async function handleFetchInterviewDetails(supabaseClient, interviewId) {
  try {
    const { data, error } = await supabaseClient.from('interview').select('*').eq('id', interviewId).single();
    if (error) {
      throw error;
    }
    return new Response(JSON.stringify({
      interview: data
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching interview details:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch interview details'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
async function handleFetchInterviewConstraints(supabaseClient, interviewId) {
  try {
    const { data, error } = await supabaseClient.from('interview_constraints').select('*').eq('interview_id', interviewId);
    if (error) {
      throw error;
    }
    return new Response(JSON.stringify({
      constraints: data
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching interview constraints:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch interview constraints'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
async function handleFetchEditData(supabaseClient, interviewId) {
  try {
    const { data, error } = await supabaseClient.from('interview').select('*').eq('id', interviewId).single();
    if (error) {
      throw error;
    }
    return new Response(JSON.stringify({
      interview: data
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching interview data for edit:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch interview data for edit'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
async function handleFetchEditConstraints(supabaseClient, interviewId) {
  try {
    const { data, error } = await supabaseClient.from('interview_constraints').select('*').eq('interview_id', interviewId);
    if (error) {
      throw error;
    }
    return new Response(JSON.stringify({
      constraints: data
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching constraints for edit:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch constraints for edit'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
async function handleFetchEditCandidates(supabaseClient, interviewId) {
  try {
    const { data, error } = await supabaseClient.from('candidate').select('*').eq('interview_id', interviewId);
    if (error) {
      throw error;
    }
    return new Response(JSON.stringify({
      candidates: data
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching candidates for edit:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch candidates for edit'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
async function handleFetchEvaluationCriteria(supabaseClient, interviewId) {
  try {
    const { data, error } = await supabaseClient.from('eval_criteria').select('*').eq('interview_id', interviewId);
    if (error) {
      throw error;
    }
    return new Response(JSON.stringify({
      evaluationCriteria: data
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching evaluation criteria:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch evaluation criteria'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
