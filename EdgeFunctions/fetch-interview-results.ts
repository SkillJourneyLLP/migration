import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { interviewId, page = 1, limit = 100 } = await req.json();
    if (!interviewId) {
      return new Response(JSON.stringify({
        error: 'Interview ID is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Calculate pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    console.log(`Fetching results for interview: ${interviewId}, page: ${page}, limit: ${limit}`);
    // Get total count
    const { count, error: countError } = await supabase.from('results').select('*', {
      count: 'exact',
      head: true
    }).eq('interview_id', interviewId);
    if (countError) {
      console.error('Error counting interview results:', countError);
      return new Response(JSON.stringify({
        error: 'Failed to count interview results'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Fetch results with pagination
    const { data: results, error } = await supabase.from('results').select('id, interview_id, candidate_id, name, gender, email, phone, status, score, recommendation, is_referred, ai_proctoring, report_link, duration, updated_at, attempted_at').eq('interview_id', interviewId).order('updated_at', {
      ascending: false
    }).range(from, to);
    if (error) {
      console.error('Error fetching interview results:', error);
      return new Response(JSON.stringify({
        error: 'Failed to fetch interview results'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const totalPages = Math.ceil((count || 0) / limit);
    console.log(`Found ${results?.length || 0} results for interview ${interviewId} (page ${page})`);
    return new Response(JSON.stringify({
      success: true,
      results: results || [],
      totalCount: count || 0,
      totalPages,
      currentPage: page
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Unexpected error:', error);
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
