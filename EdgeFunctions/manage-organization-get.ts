import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verify } from 'https://deno.land/x/djwt@v2.8/mod.ts';
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
    // Internal JWT verification
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return new Response(JSON.stringify({
        error: 'Missing authorization token'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const jwtSecret = Deno.env.get('JWT_SECRET');
    if (!jwtSecret) {
      console.error('JWT_SECRET not configured');
      return new Response(JSON.stringify({
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(jwtSecret), {
      name: 'HMAC',
      hash: 'SHA-256'
    }, false, [
      'verify'
    ]);
    let payload;
    try {
      payload = await verify(token, key);
    } catch (err) {
      console.error('JWT verification failed:', err);
      return new Response(JSON.stringify({
        error: 'Invalid token'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!payload || !payload.userId) {
      return new Response(JSON.stringify({
        error: 'Invalid token payload'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { requestingUserId } = await req.json();
    // Verify token userId matches requestingUserId
    if (payload.userId !== requestingUserId) {
      return new Response(JSON.stringify({
        error: 'Token user mismatch'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!requestingUserId) {
      return new Response(JSON.stringify({
        error: 'requestingUserId is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Fetch requesting user
    const { data: userRow, error: userErr } = await supabase.from('users').select('id, email, role, organization_id, created_at').eq('id', requestingUserId).maybeSingle();
    if (userErr) {
      console.error('Error fetching requesting user:', userErr);
      return new Response(JSON.stringify({
        error: 'Failed to fetch user'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!userRow) {
      return new Response(JSON.stringify({
        error: 'User not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const userRole = userRow.role?.toLowerCase();
    if (!userRole || userRole !== 'admin' && userRole !== 'primaryadmin') {
      return new Response(JSON.stringify({
        error: 'Access denied'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!userRow.organization_id) {
      return new Response(JSON.stringify({
        error: 'User has no organization'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const organizationId = userRow.organization_id;
    // Fetch organization
    console.log('Fetching organization with ID:', organizationId);
    const { data: org, error: orgErr } = await supabase.from('organizations').select('id, name, description, credits, remaining_credits, created_at, updated_at').eq('id', organizationId).maybeSingle();
    console.log('Organization fetch result:', {
      org,
      error: orgErr
    });
    if (orgErr) {
      console.error('Error fetching organization:', orgErr);
      return new Response(JSON.stringify({
        error: 'Failed to fetch organization'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Fetch admins (admin + primaryadmin) - case insensitive role matching
    const { data: adminsRows, error: adminsErr } = await supabase.from('users').select('id, email, role, created_at').eq('organization_id', organizationId).order('created_at', {
      ascending: false
    });
    if (adminsErr) {
      console.error('Error fetching admins:', adminsErr);
      return new Response(JSON.stringify({
        error: 'Failed to fetch administrators'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Filter admins by role (case insensitive) and extract name from email
    const admins = (adminsRows || []).filter((a)=>{
      const roleLower = a.role?.toLowerCase();
      return roleLower === 'admin' || roleLower === 'primaryadmin';
    }).map((a)=>({
        id: a.id,
        email: a.email,
        name: a.email?.split('@')[0] || 'Unknown',
        role: a.role?.toLowerCase(),
        created_at: a.created_at
      }));
    console.log('Returning response:', {
      userRole,
      organization: org,
      adminsCount: admins.length
    });
    return new Response(JSON.stringify({
      userRole,
      organization: org,
      admins
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('manage-organization-get error:', error);
    return new Response(JSON.stringify({
      error: error.message ?? 'Unexpected error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
