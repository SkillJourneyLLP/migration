import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceKey);
serve(async (req)=>{
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    // Expecting a POST with JSON body { organization_id?: string, user_id?: string }
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed'
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    let body = {};
    try {
      body = await req.json();
    } catch (_) {}
    const providedOrgId = body?.organization_id || body?.organizationId;
    const userId = body?.user_id || body?.userId;
    let organizationId = providedOrgId;
    if (!organizationId) {
      if (!userId) {
        return new Response(JSON.stringify({
          error: 'organization_id or user_id is required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      console.log('[archived-interviews] Resolving organization_id for user:', userId);
      const { data: userData, error: userError } = await supabase.from('users').select('organization_id').eq('id', userId).single();
      if (userError) {
        console.error('[archived-interviews] Failed to fetch user data:', userError);
        return new Response(JSON.stringify({
          error: 'Failed to fetch user data'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      organizationId = userData?.organization_id || undefined;
    }
    if (!organizationId) {
      console.warn('[archived-interviews] No organization_id available, returning empty list');
      return new Response(JSON.stringify({
        archivedInterviews: []
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Get archived interviews
    let archivedQuery = supabase.from('interview').select('id, job_position:position, start_date, start_time, end_date, end_time, duration, created_at').eq('is_archived', true).neq('is_deleted', true);
    archivedQuery = archivedQuery.eq('organization_id', organizationId);
    const { data: archivedInterviews, error: archivedError } = await archivedQuery;
    if (archivedError) {
      console.error('[archived-interviews] Failed to fetch archived interviews:', archivedError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch archived interviews'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Get candidate counts for each archived interview
    const interviewsWithCounts = [];
    for (const interview of archivedInterviews || []){
      const { count, error: countError } = await supabase.from('results').select('*', {
        count: 'exact',
        head: true
      }).eq('interview_id', interview.id);
      if (countError) {
        console.warn('[archived-interviews] Failed to fetch count for interview', interview.id, countError);
      }
      interviewsWithCounts.push({
        ...interview,
        candidateCount: count || 0
      });
    }
    return new Response(JSON.stringify({
      archivedInterviews: interviewsWithCounts
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in archived-interviews function:', error);
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
