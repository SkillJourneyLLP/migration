import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { email, role, organizationId, requestingUserId } = await req.json();
    if (!email || !role || !organizationId || !requestingUserId) {
      return new Response(JSON.stringify({
        error: 'Missing required fields'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Verify requesting user is a primary admin
    const { data: requestingUserRole, error: roleCheckError } = await supabase.from('user_roles').select('role').eq('user_id', requestingUserId).eq('organization_id', organizationId).single();
    if (roleCheckError || requestingUserRole?.role !== 'primaryadmin') {
      return new Response(JSON.stringify({
        error: 'Only primary admins can add administrators'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // If adding a primary admin, check the limit
    if (role === 'primaryadmin') {
      const { data: primaryAdminCount, error: countError } = await supabase.from('user_roles').select('id', {
        count: 'exact',
        head: true
      }).eq('organization_id', organizationId).eq('role', 'primaryadmin');
      if (countError) {
        console.error('Error counting primary admins:', countError);
        return new Response(JSON.stringify({
          error: 'Failed to verify primary admin limit'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      if ((primaryAdminCount || 0) >= 2) {
        return new Response(JSON.stringify({
          error: 'Maximum of 2 primary admins allowed per organization'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Check if user exists
    const { data: existingUser, error: userError } = await supabase.from('users').select('id, organization_id').eq('email', email).single();
    if (userError && userError.code !== 'PGRST116') {
      console.error('Error checking user:', userError);
      return new Response(JSON.stringify({
        error: 'Failed to check user existence'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    let userId;
    if (!existingUser) {
      // Create new user with a temporary password (they should reset it)
      const tempPassword = crypto.randomUUID();
      const { data: newUser, error: createError } = await supabase.from('users').insert({
        email,
        password: tempPassword,
        organization_id: organizationId,
        role: 'user'
      }).select('id').single();
      if (createError) {
        console.error('Error creating user:', createError);
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
      userId = newUser.id;
    } else {
      // Verify user is in the same organization
      if (existingUser.organization_id !== organizationId) {
        return new Response(JSON.stringify({
          error: 'User belongs to a different organization'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      userId = existingUser.id;
      // Check if user already has a role
      const { data: existingRole, error: roleError } = await supabase.from('user_roles').select('id').eq('user_id', userId).eq('organization_id', organizationId).single();
      if (existingRole) {
        return new Response(JSON.stringify({
          error: 'User already has an admin role in this organization'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Add the role
    const { error: insertError } = await supabase.from('user_roles').insert({
      user_id: userId,
      organization_id: organizationId,
      role
    });
    if (insertError) {
      console.error('Error adding role:', insertError);
      return new Response(JSON.stringify({
        error: 'Failed to add admin role'
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
    console.error('Error:', error);
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
