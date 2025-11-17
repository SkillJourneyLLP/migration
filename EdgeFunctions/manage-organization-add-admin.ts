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
    const { requestingUserId, email, role, organizationId, password } = await req.json();
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
    if (!requestingUserId || !email || !role || !organizationId) {
      return new Response(JSON.stringify({
        error: 'requestingUserId, email, role, organizationId are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const normalizedRole = role.toLowerCase();
    if (![
      'admin',
      'primaryadmin'
    ].includes(normalizedRole)) {
      return new Response(JSON.stringify({
        error: 'Invalid role'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Validate requesting user has primaryadmin
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
        error: 'Only primary admins can add admins'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Enforce at most 2 primaryadmins
    if (normalizedRole === 'primaryadmin') {
      const { data: primaryAdmins, error: paErr } = await supabase.from('users').select('id').eq('organization_id', organizationId).eq('role', 'primaryadmin');
      if (paErr) {
        console.error('Error counting primary admins:', paErr);
        return new Response(JSON.stringify({
          error: 'Failed to validate primary admin limit'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      if ((primaryAdmins?.length || 0) >= 2) {
        return new Response(JSON.stringify({
          error: 'Maximum 2 primary admins allowed per organization.'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Validate password if provided
    if (password && password.length < 8) {
      return new Response(JSON.stringify({
        error: 'Password must be at least 8 characters long'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check if user exists
    const { data: existingUser, error: userErr } = await supabase.from('users').select('id, organization_id, role').eq('email', email).maybeSingle();
    if (userErr) {
      console.error('Error fetching target user:', userErr);
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
    if (!existingUser) {
      // User doesn't exist - create new user
      if (!password) {
        return new Response(JSON.stringify({
          error: 'Password is required for new users'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { data: newUser, error: createErr } = await supabase.from('users').insert({
        email,
        password,
        role: normalizedRole,
        organization_id: organizationId
      }).select().single();
      if (createErr) {
        console.error('Error creating user:', createErr);
        return new Response(JSON.stringify({
          error: 'Failed to create user'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      console.log('Successfully created new user:', newUser.id);
      return new Response(JSON.stringify({
        success: true
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // User exists - update role and organization
    if (existingUser.organization_id && existingUser.organization_id !== organizationId) {
      return new Response(JSON.stringify({
        error: 'This user already belongs to another organization.'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { error: updateErr } = await supabase.from('users').update({
      role: normalizedRole,
      organization_id: organizationId
    }).eq('id', existingUser.id);
    if (updateErr) {
      console.error('Error updating user role/org:', updateErr);
      return new Response(JSON.stringify({
        error: 'Failed to add admin'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      success: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('manage-organization-add-admin error:', error);
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
