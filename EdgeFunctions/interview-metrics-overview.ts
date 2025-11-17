// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verify } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const jwtSecret = Deno.env.get('JWT_SECRET') || 'default-secret-key-change-in-production';
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(jwtSecret), {
  name: "HMAC",
  hash: "SHA-256"
}, false, [
  "sign",
  "verify"
]);
// Compute status based on start/end date and time vs current time
const computeInterviewStatus = (interview)=>{
  try {
    const parseDateTime = (dateStr, timeStr)=>{
      if (!dateStr) return null;
      const [y, m, d] = dateStr.split("-").map((s)=>parseInt(s, 10));
      if (!timeStr || timeStr.length === 0) {
        return new Date(y, m - 1, d, 0, 0, 0);
      }
      const parts = timeStr.split(":").map((s)=>parseInt(s, 10));
      const hh = parts[0] || 0;
      const mm = parts[1] || 0;
      const ss = parts[2] || 0;
      return new Date(y, m - 1, d, hh, mm, ss);
    };
    const start = parseDateTime(interview.start_date, interview.start_time);
    let end = parseDateTime(interview.end_date, interview.end_time);
    if (!end && start && interview.duration) {
      end = new Date(start.getTime() + Number(interview.duration) * 60 * 1000);
    }
    const now = new Date();
    if (!start) {
      return interview.status || "Scheduled";
    }
    if (now < start) {
      return "Scheduled";
    }
    if (end && now > end) {
      return "Completed";
    }
    return "Active";
  } catch  {
    return interview.status || "Scheduled";
  }
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { action } = await req.json();
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Authorization required'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const payload = await verify(token, key);
    const userId = payload.userId;
    // Handle different actions
    if (action === 'getInterviewApplicationCounts') {
      return await handleGetInterviewApplicationCounts(userId);
    }
    // Get user's organization info first
    const { data: userData, error: userError } = await supabase.from('users').select('organization_id').eq('id', userId).single();
    if (userError) {
      console.error('Error fetching user data:', userError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch user data'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const organizationId = userData?.organization_id;
    // Get all interviews for the user/organization
    let interviewQuery = supabase.from('interview').select('*').eq('is_deleted', false).eq('is_archived', false);
    // If user has an organization, filter by organization, otherwise by user
    if (organizationId) {
      interviewQuery = interviewQuery.eq('organization_id', organizationId);
    } else {
      interviewQuery = interviewQuery.eq('user_id', userId);
    }
    const { data: interviews, error: interviewsError } = await interviewQuery;
    if (interviewsError) {
      console.error('Error fetching interviews:', interviewsError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch interviews'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const totalInterviews = interviews.length;
    // Count active interviews using the computed status
    const activeInterviews = interviews.filter((interview)=>computeInterviewStatus(interview) === 'Active').length;
    // Get interview IDs for querying results
    const interviewIds = interviews.map((i)=>i.id);
    // Get total applications count from results table for these interviews
    let totalApplications = 0;
    let totalShortlisted = 0;
    if (interviewIds.length > 0) {
      // Get total applications count (all applications regardless of status)
      const { count: applicationsCount } = await supabase.from('results').select('*', {
        count: 'exact',
        head: true
      }).in('interview_id', interviewIds);
      // Get total shortlisted count
      const { count: shortlistedCount } = await supabase.from('results').select('*', {
        count: 'exact',
        head: true
      }).in('interview_id', interviewIds).eq('status', 'shortlisted');
      totalApplications = applicationsCount || 0;
      totalShortlisted = shortlistedCount || 0;
    }
    const metrics = {
      totalInterviews,
      activeInterviews,
      totalApplications,
      totalShortlisted
    };
    console.log('Calculated metrics:', metrics);
    return new Response(JSON.stringify({
      metrics
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in interview-metrics-overview function:', error);
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
async function handleGetInterviewApplicationCounts(userId) {
  try {
    // Get user's organization info first
    const { data: userData, error: userError } = await supabase.from('users').select('organization_id').eq('id', userId).single();
    if (userError) {
      throw new Error('Failed to fetch user data');
    }
    const organizationId = userData?.organization_id;
    // Get all interviews for the user/organization
    let interviewQuery = supabase.from('interview').select('id').eq('is_deleted', false).eq('is_archived', false);
    if (organizationId) {
      interviewQuery = interviewQuery.eq('organization_id', organizationId);
    } else {
      interviewQuery = interviewQuery.eq('user_id', userId);
    }
    const { data: interviews, error: interviewsError } = await interviewQuery;
    if (interviewsError) {
      throw new Error('Failed to fetch interviews');
    }
    const interviewIds = interviews.map((i)=>i.id);
    const applicationCounts = {};
    // Get counts for each interview
    for (const interviewId of interviewIds){
      // Get total applications count
      const { count: totalCount } = await supabase.from('results').select('*', {
        count: 'exact',
        head: true
      }).eq('interview_id', interviewId);
      // Get attempted count (excluding pending and reattempt)
      const { count: attemptedCount } = await supabase.from('results').select('*', {
        count: 'exact',
        head: true
      }).eq('interview_id', interviewId).not('status', 'in', '("pending","reattempt")');
      applicationCounts[interviewId] = {
        total: totalCount || 0,
        attempted: attemptedCount || 0
      };
    }
    return new Response(JSON.stringify({
      applicationCounts
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error getting application counts:', error);
    return new Response(JSON.stringify({
      error: 'Failed to get application counts'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}
