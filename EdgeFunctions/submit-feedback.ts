import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.53.0';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { candidate_id, interview_id, rating, feedback_text } = await req.json();
    // Validate required fields
    if (!candidate_id || !interview_id || !rating) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: candidate_id, interview_id, and rating are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Validate rating is between 1 and 5
    if (rating < 1 || rating > 5) {
      return new Response(JSON.stringify({
        error: 'Rating must be between 1 and 5'
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
    // Insert or update feedback
    const { data, error } = await supabase.from('feedback').upsert({
      candidate_id,
      interview_id,
      rating,
      feedback_text: feedback_text || null
    }, {
      onConflict: 'candidate_id,interview_id'
    }).select().single();
    if (error) {
      console.error('Error inserting feedback:', error);
      return new Response(JSON.stringify({
        error: 'Failed to save feedback'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Feedback saved successfully:', data);
    return new Response(JSON.stringify({
      success: true,
      message: 'Feedback saved successfully',
      data
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in submit-feedback function:', error);
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
