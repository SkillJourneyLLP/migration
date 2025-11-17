import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { candidateId, duration } = await req.json();
    if (!candidateId || duration === undefined) {
      return new Response(JSON.stringify({
        error: 'candidateId and duration are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Deducting credits for candidate: ${candidateId}, duration: ${duration}`);
    // Step 1: Get interview_id from candidates table
    const { data: candidateData, error: candidateError } = await supabase.from('candidate').select('interview_id').eq('id', candidateId).single();
    if (candidateError || !candidateData) {
      console.error('Error fetching candidate:', candidateError);
      return new Response(JSON.stringify({
        error: 'Candidate not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const interviewId = candidateData.interview_id;
    console.log(`Interview ID: ${interviewId}`);
    // Step 2: Get organization_id from interview table
    const { data: interviewData, error: interviewError } = await supabase.from('interview').select('organization_id').eq('id', interviewId).single();
    if (interviewError || !interviewData || !interviewData.organization_id) {
      console.error('Error fetching interview:', interviewError);
      return new Response(JSON.stringify({
        error: 'Interview or organization not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const organizationId = interviewData.organization_id;
    console.log(`Organization ID: ${organizationId}`);
    // Step 3: Calculate credits to deduct
    const durationInMinutes = Math.round(duration);
    const creditsToDeduct = durationInMinutes < 10 ? 10 : durationInMinutes;
    console.log(`Credits to deduct: ${creditsToDeduct}`);
    // Step 4: Get current remaining credits
    const { data: orgData, error: orgFetchError } = await supabase.from('organizations').select('remaining_credits').eq('id', organizationId).single();
    if (orgFetchError || !orgData) {
      console.error('Error fetching organization:', orgFetchError);
      return new Response(JSON.stringify({
        error: 'Organization not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const currentCredits = orgData.remaining_credits || 0;
    const newCredits = Math.max(0, currentCredits - creditsToDeduct);
    console.log(`Current credits: ${currentCredits}, New credits: ${newCredits}`);
    // Step 5: Update remaining_credits in organizations table
    const { error: updateError } = await supabase.from('organizations').update({
      remaining_credits: newCredits
    }).eq('id', organizationId);
    if (updateError) {
      console.error('Error updating credits:', updateError);
      return new Response(JSON.stringify({
        error: 'Failed to update credits'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Successfully deducted ${creditsToDeduct} credits from organization ${organizationId}`);
    return new Response(JSON.stringify({
      success: true,
      creditsDeducted: creditsToDeduct,
      remainingCredits: newCredits
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in deduct-credits function:', error);
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
