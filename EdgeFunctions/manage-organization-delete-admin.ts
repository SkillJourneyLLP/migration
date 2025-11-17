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
    const { requestingUserId, adminId, organizationId } = await req.json();
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
    if (!requestingUserId || !adminId || !organizationId) {
      return new Response(JSON.stringify({
        error: 'requestingUserId, adminId, and organizationId are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Prevent self-deletion
    if (requestingUserId === adminId) {
      return new Response(JSON.stringify({
        error: 'You cannot delete yourself'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Validate requesting user is primaryadmin
    const { data: reqUser, error: reqErr } = await supabase.from('users').select('id, role, organization_id').eq('id', requestingUserId).maybeSingle();
    if (reqErr) {
      console.error('Error fetching requesting user:', reqErr);
      return new Response(JSON.stringify({
        error: 'Failed to validate requester'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!reqUser || reqUser.role?.toLowerCase() !== 'primaryadmin' || reqUser.organization_id !== organizationId) {
      return new Response(JSON.stringify({
        error: 'Only primary admins can delete admins'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Fetch the admin to delete and verify they belong to the same organization
    const { data: targetAdmin, error: targetErr } = await supabase.from('users').select('id, role, organization_id').eq('id', adminId).maybeSingle();
    if (targetErr || !targetAdmin) {
      console.error('Error fetching target admin:', targetErr);
      return new Response(JSON.stringify({
        error: 'Admin not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (targetAdmin.organization_id !== organizationId) {
      return new Response(JSON.stringify({
        error: 'Admin does not belong to your organization'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Delete the admin
    const { error: deleteErr } = await supabase.from('users').delete().eq('id', adminId);
    if (deleteErr) {
      console.error('Error deleting admin:', deleteErr);
      return new Response(JSON.stringify({
        error: 'Failed to delete admin'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Admin ${adminId} deleted by ${requestingUserId}`);
    return new Response(JSON.stringify({
      success: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('manage-organization-delete-admin error:', error);
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
