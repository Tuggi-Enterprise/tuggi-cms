import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/core/supabase-client';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = getSupabase('server');

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const country = searchParams.get('country');
    const state = searchParams.get('state');

    if (country) {
      // Get cities for a specific country and optionally state
      let query = supabase
        .schema('core')
        .from('attractions')
        .select('city')
        .eq('country', country)
        .not('city', 'is', null)
        .order('city');

      // Add state filter if provided
      if (state) {
        query = query.eq('state', state);
      }

      const { data: cities, error } = await query;

      if (error) {
        console.error('Error fetching cities:', error);
        return NextResponse.json(
          { error: 'Failed to fetch cities' },
          { status: 500 }
        );
      }

      // Remove duplicates and sort
      const uniqueCities = [...new Set(cities.map(item => item.city))]
        .filter(city => city && city.trim() !== '')
        .sort();

      return NextResponse.json({
        success: true,
        cities: uniqueCities,
        count: uniqueCities.length
      });
    } else {
      // Get all countries with their city counts
      let allData: any[] = [];
      let hasMore = true;
      let page = 0;
      const pageSize = 1000;

      // Fetch all data with pagination to overcome 1000 limit
      while (hasMore) {
        const { data: chunk, error } = await supabase
          .schema('core')
          .from('attractions')
          .select('country, city')
          .not('country', 'is', null)
          .not('city', 'is', null)
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.error('Error fetching data:', error);
          break;
        }

        if (chunk && chunk.length > 0) {
          allData = [...allData, ...chunk];
          page++;
        } else {
          hasMore = false;
        }

        // Safety check to prevent infinite loops
        if (page > 20) {
          hasMore = false;
        }
      }

      // Process the data to get countries with city counts
      const countryStats = allData.reduce((acc: Record<string, Set<string>>, item) => {
        if (item.country && item.city) {
          if (!acc[item.country]) {
            acc[item.country] = new Set();
          }
          acc[item.country].add(item.city);
        }
        return acc;
      }, {});

      const countries = Object.entries(countryStats)
        .map(([country, cities]) => ({
          country,
          cityCount: cities.size,
          totalPOIs: allData.filter(item => item.country === country).length
        }))
        .sort((a, b) => b.totalPOIs - a.totalPOIs);

      return NextResponse.json({
        success: true,
        countries,
        totalCountries: countries.length,
        totalDataPoints: allData.length
      });
    }
  } catch (error) {
    console.error('Error in countries-cities API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
