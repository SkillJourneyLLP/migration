import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
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
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });
  }
  try {
    const { candidateId, interviewId } = await req.json();
    if (!candidateId || !interviewId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing candidateId or interviewId'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Supabase client
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    console.log(`Updating referral status for candidate: ${candidateId}, interview: ${interviewId}`);
    // Update the candidate's is_referred status to true
    const { data: updateData, error: updateError } = await supabase.from('candidate').update({
      is_referred: true,
      updated_at: new Date().toISOString()
    }).eq('id', candidateId).eq('interview_id', interviewId).select();
    if (updateError) {
      console.error('Error updating candidate referral status:', updateError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to update referral status'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!updateData || updateData.length === 0) {
      console.error('No candidate found with provided ID and interview ID');
      return new Response(JSON.stringify({
        success: false,
        error: 'Candidate not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Successfully updated referral status:', updateData[0]);
    return new Response(JSON.stringify({
      success: true,
      message: 'Referral status updated successfully',
      candidate: updateData[0]
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in update-referral-status function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
};
serve(handler);
